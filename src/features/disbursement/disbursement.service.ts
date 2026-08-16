import { BadRequestException, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Transaction } from '../../entities/transaction.entity';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const queue = new Queue('disburse', { connection });

@Injectable()
export class DisbursementService {
  async enqueueTransactions(batchId: string, transactions: Transaction[]) {
    if (!batchId || !Array.isArray(transactions)) {
      throw new BadRequestException('A batch ID and transactions are required.');
    }
    const promises = transactions.map((transaction) => queue.add(
      'disburse',
      { batchId, transactionId: transaction.id },
      {
        jobId: transaction.id,
        removeOnComplete: 1000,
        removeOnFail: 5000,
        // Never blindly retry an uncertain financial request. Kora references must
        // be reconciled before an operator decides whether to retry a payout.
        attempts: 1,
      },
    ));
    await Promise.all(promises);
    return { queued: transactions.length };
  }
}
