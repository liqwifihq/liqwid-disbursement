import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { AuditLog } from '../../entities/audit.entity';
import { Batch } from '../../entities/batch.entity';
import { Transaction } from '../../entities/transaction.entity';
import { AppDataSource } from '../../ormconfig';
import { requestActor, requireRole } from '../../security/actor';
import { DisbursementService } from '../disbursement/disbursement.service';

@Controller('batches')
export class BatchesController {
  constructor(private readonly disbursementService: DisbursementService) {}

  @Get()
  async list() {
    return AppDataSource.getRepository(Batch).find({
      relations: ['transactions'],
      select: {
        id: true,
        uploadedBy: true,
        totalAmount: true,
        status: true,
        approvedBy: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
        transactions: { id: true, status: true, currency: true },
      },
      order: { createdAt: 'DESC' },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const batch = await AppDataSource.getRepository(Batch).findOne({
      where: { id },
      relations: ['transactions'],
      order: { transactions: { createdAt: 'ASC' } },
    });
    if (!batch) throw new NotFoundException('Batch not found.');
    return batch;
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Headers('x-admin-actor') actorHeader?: string,
    @Headers('x-admin-role') roleHeader?: string,
  ) {
    const actor = requestActor(actorHeader, roleHeader);
    requireRole(actor, ['approver', 'admin']);
    return AppDataSource.transaction(async (manager) => {
      const batchRepo = manager.getRepository(Batch);
      const batch = await batchRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!batch) throw new NotFoundException('Batch not found.');
      if (batch.status !== 'ready') throw new BadRequestException('Only ready batches can be approved.');
      const transactionCount = await manager.getRepository(Transaction).count({ where: { batch: { id } } });
      if (!transactionCount) throw new BadRequestException('An empty batch cannot be approved.');
      batch.status = 'approved';
      batch.approvedBy = actor.email;
      batch.approvedAt = new Date();
      await batchRepo.save(batch);
      await manager.getRepository(AuditLog).save({
        actor: actor.email,
        action: 'approve_batch',
        details: { batchId: id, creator: batch.uploadedBy },
      });
      return { approved: true, approvedBy: actor.email, approvedAt: batch.approvedAt };
    });
  }

  @Post(':id/disburse')
  async disburse(
    @Param('id') id: string,
    @Headers('x-admin-actor') actorHeader?: string,
    @Headers('x-admin-role') roleHeader?: string,
  ) {
    const actor = requestActor(actorHeader, roleHeader);
    requireRole(actor, ['approver', 'admin']);
    const batchRepo = AppDataSource.getRepository(Batch);
    const batch = await batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('Batch not found.');
    if (batch.status !== 'approved' || !batch.approvedAt || !batch.approvedBy) {
      throw new BadRequestException('This batch must be approved before disbursement.');
    }

    const transactions = await AppDataSource.getRepository(Transaction).find({
      where: { batch: { id }, status: 'pending' },
    });
    if (transactions.length) {
      await this.disbursementService.enqueueTransactions(id, transactions);
      await batchRepo.update({ id, status: 'approved' }, { status: 'processing' });
      await AppDataSource.getRepository(AuditLog).save({
        actor: actor.email,
        action: 'enqueue_disbursement',
        details: { batchId: id, count: transactions.length, approvedBy: batch.approvedBy },
      });
    }
    return { enqueued: transactions.length };
  }
}
