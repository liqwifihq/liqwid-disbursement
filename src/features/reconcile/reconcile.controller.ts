import { BadRequestException, Body, Controller, Headers, NotFoundException, Post } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLog } from '../../entities/audit.entity';
import { Batch, BatchStatus } from '../../entities/batch.entity';
import { Transaction } from '../../entities/transaction.entity';
import { AppDataSource } from '../../ormconfig';
import { requestActor, requireRole } from '../../security/actor';
import { KorapayService } from '../../services/korapay.service';
import { parseMinorUnits } from '../../utils/money';
import { enqueuePaymentAlert } from '../../queues/payment-queues';

function providerMatches(transaction: Transaction, data: any) {
  try {
    if (data?.reference && data.reference !== transaction.reference) return false;
    if (data?.currency && String(data.currency).toUpperCase() !== transaction.currency) return false;
    if (data?.amount !== undefined && parseMinorUnits(String(data.amount)) !== parseMinorUnits(transaction.amount)) return false;
    return true;
  } catch {
    return false;
  }
}

@Controller('reconcile')
@ApiTags('Reconciliation')
export class ReconcileController {
  @Post('batch')
  @ApiOperation({ summary: 'Query Kora and reconcile a batch manually' })
  @ApiHeader({ name: 'x-admin-actor', description: 'Authenticated operator email', required: true })
  @ApiHeader({ name: 'x-admin-role', description: 'Operator role: approver or admin', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['batchId'],
      properties: { batchId: { type: 'string', format: 'uuid' } },
    },
  })
  async reconcileBatch(
    @Body() body: { batchId?: string },
    @Headers('x-admin-actor') actorHeader?: string,
    @Headers('x-admin-role') roleHeader?: string,
  ) {
    const actor = requestActor(actorHeader, roleHeader);
    requireRole(actor, ['approver', 'admin']);
    if (!body?.batchId) throw new BadRequestException('A batch ID is required.');
    const batch = await AppDataSource.getRepository(Batch).findOneBy({ id: body.batchId });
    if (!batch) throw new NotFoundException('Batch not found.');

    const korapay = new KorapayService();
    const txRepo = AppDataSource.getRepository(Transaction);
    const txs = await txRepo.find({ where: { batch: { id: body.batchId } } });
    const results = [];
    for (const transaction of txs) {
      if (!['processing', 'pending_review'].includes(transaction.status)) {
        results.push({ reference: transaction.reference, status: transaction.status, changed: false });
        continue;
      }
      const response = await korapay.getPayoutStatus(transaction.reference);
      const data = response?.data;
      if (!providerMatches(transaction, data)) {
        results.push({ reference: transaction.reference, status: transaction.status, changed: false, mismatch: true });
        continue;
      }
      const providerStatus = data?.status;
      const status = providerStatus === 'success'
        ? 'succeeded'
        : providerStatus === 'failed'
          ? 'failed'
          : providerStatus === 'simulated'
            ? 'simulated'
            : transaction.status;
      const changed = status !== transaction.status;
      if (changed) {
        await txRepo.update({ id: transaction.id, status: transaction.status }, { status, providerResponse: response });
        if (status === 'succeeded' || status === 'failed') {
          await enqueuePaymentAlert({
            batchId: body.batchId,
            transactionId: transaction.id,
            reference: transaction.reference,
            amount: transaction.amount,
            currency: transaction.currency,
            status,
            message: String(data?.message || response?.message || '').trim() || undefined,
          });
        }
      }
      results.push({ reference: transaction.reference, status, changed });
    }

    const statuses = results.map((result) => result.status);
    let batchStatus: BatchStatus = 'processing';
    if (statuses.length && statuses.every((status) => status === 'succeeded')) batchStatus = 'completed';
    else if (statuses.length && statuses.every((status) => status === 'simulated')) batchStatus = 'simulated';
    else if (statuses.length && statuses.every((status) => ['succeeded', 'failed'].includes(status))) batchStatus = 'completed_with_errors';
    await AppDataSource.getRepository(Batch).update({ id: body.batchId }, { status: batchStatus });
    await AppDataSource.getRepository(AuditLog).save({
      actor: actor.email,
      action: 'reconcile_batch',
      details: { batchId: body.batchId, checked: results.length, changed: results.filter((item) => item.changed).length },
    });
    return { reconciled: results };
  }
}
