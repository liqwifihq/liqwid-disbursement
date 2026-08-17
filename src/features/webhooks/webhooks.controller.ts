import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLog } from '../../entities/audit.entity';
import { Batch, BatchStatus } from '../../entities/batch.entity';
import { Transaction } from '../../entities/transaction.entity';
import { AppDataSource } from '../../ormconfig';
import { enqueuePayoutSuccessEmail } from '../../queues/payment-queues';
import { KorapayService } from '../../services/korapay.service';
import { LoggerService } from '../../services/logger.service';
import { parseMinorUnits } from '../../utils/money';

const logger = new LoggerService();

function sameAmount(left: unknown, right: string) {
  try {
    return parseMinorUnits(String(left)) === parseMinorUnits(right);
  } catch {
    return false;
  }
}

async function updateBatchStatus(batchId: string) {
  const transactions = await AppDataSource.getRepository(Transaction).find({ where: { batch: { id: batchId } } });
  const statuses = transactions.map((item) => item.status);
  let status: BatchStatus = 'processing';
  if (statuses.length && statuses.every((item) => item === 'succeeded')) status = 'completed';
  else if (statuses.length && statuses.every((item) => item === 'simulated')) status = 'simulated';
  else if (statuses.length && statuses.every((item) => ['succeeded', 'failed'].includes(item))) status = 'completed_with_errors';
  await AppDataSource.getRepository(Batch).update({ id: batchId }, { status });
}

@Controller('webhooks')
@ApiTags('Webhooks')
export class WebhooksController {
  @Post('korapay')
  @ApiOperation({ summary: 'Receive a signed Kora payment-status webhook' })
  @ApiHeader({ name: 'x-korapay-signature', description: 'Kora webhook signature', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['event', 'data'],
      properties: {
        event: { type: 'string', example: 'transfer.success' },
        data: { type: 'object', additionalProperties: true },
      },
    },
  })
  async korapay(@Body() payload: any, @Headers('x-korapay-signature') signature?: string) {
    const korapay = new KorapayService();
    if (!korapay.verifyWebhookSignature(payload?.data, signature)) {
      logger.warn('Rejected webhook with an invalid Kora signature');
      return { received: false };
    }

    const data = payload?.data;
    const reference = typeof data?.reference === 'string' ? data.reference : '';
    const event = String(payload?.event || '');
    const status = event === 'transfer.success' ? 'succeeded' : event === 'transfer.failed' ? 'failed' : null;
    if (!reference || !status) return { received: true, updated: false };

    const txRepo = AppDataSource.getRepository(Transaction);
    const transaction = await txRepo.findOne({ where: { reference }, relations: ['batch'] });
    if (!transaction) return { received: true, updated: false };
    if (String(data.currency || '').toUpperCase() !== transaction.currency || !sameAmount(data.amount, transaction.amount)) {
      logger.warn('Rejected Kora webhook with mismatched payment data', { reference });
      await AppDataSource.getRepository(AuditLog).save({
        actor: 'korapay',
        action: 'reject_webhook_mismatch',
        details: { batchId: transaction.batch.id, transactionId: transaction.id, reference },
      });
      return { received: true, updated: false };
    }
    if (transaction.status === status) return { received: true, updated: false };
    if (['succeeded', 'failed', 'simulated'].includes(transaction.status)) {
      logger.warn('Ignored webhook that would change a terminal payment state', { reference, current: transaction.status, requested: status });
      return { received: true, updated: false };
    }

    const updated = await txRepo.update(
      { id: transaction.id, status: transaction.status },
      { status, providerResponse: payload },
    );
    if (!updated.affected) return { received: true, updated: false };
    await updateBatchStatus(transaction.batch.id);
    await AppDataSource.getRepository(AuditLog).save({
      actor: 'korapay',
      action: 'payment_webhook_transition',
      details: { batchId: transaction.batch.id, transactionId: transaction.id, reference, from: transaction.status, to: status },
    });
    if (status === 'succeeded') {
      await enqueuePayoutSuccessEmail({ batchId: transaction.batch.id, transactionId: transaction.id });
    }
    logger.info('Processed Kora webhook', { reference, status });
    return { received: true, updated: true };
  }
}
