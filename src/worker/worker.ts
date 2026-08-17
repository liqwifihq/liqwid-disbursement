import 'reflect-metadata';
import axios from 'axios';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { Batch, BatchStatus } from '../entities/batch.entity';
import { Transaction } from '../entities/transaction.entity';
import { AppDataSource } from '../ormconfig';
import { KorapayService } from '../services/korapay.service';
import {
  sendDiscordPaymentAlert,
  sendDiscordWorkerErrorAlert,
  validateDiscordPaymentAlerts,
  WorkerErrorAlert,
} from '../services/discord-alert.service';
import { getPaymentMode, validateRuntimeConfig } from '../config';
import {
  enqueuePaymentAlert,
  enqueuePaymentConfirmation,
  PAYMENT_ALERT_QUEUE,
  PAYMENT_CONFIRMATION_QUEUE,
  PaymentAlertJob,
  PaymentConfirmationJob,
} from '../queues/payment-queues';
import { parseMinorUnits } from '../utils/money';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const WORKER_ALERT_THROTTLE_MS = 5 * 60_000;
const workerAlertTimes = new Map<string, number>();

function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ? `HTTP ${error.response.status}: ` : '';
    const responseMessage = String(error.response?.data?.message || '').trim();
    return `${status}${responseMessage || error.message || 'Provider request failed.'}`.slice(0, 1000);
  }
  return (error instanceof Error ? error.message : String(error || 'Unknown worker error')).slice(0, 1000);
}

async function reportWorkerError(alert: WorkerErrorAlert) {
  const fingerprint = `${alert.component}:${alert.jobId || ''}:${alert.message}`;
  const now = Date.now();
  const lastSent = workerAlertTimes.get(fingerprint) || 0;
  if (now - lastSent < WORKER_ALERT_THROTTLE_MS) return;
  workerAlertTimes.set(fingerprint, now);

  try {
    await sendDiscordWorkerErrorAlert(alert);
  } catch (notificationError) {
    console.error('Worker Discord notification failed:', errorMessage(notificationError));
  }
}

type FailedJob = {
  id?: string;
  name?: string;
  data?: unknown;
  attemptsMade: number;
  opts: { attempts?: number };
};

function reportFinalJobFailure(component: string, job: FailedJob | undefined, error: unknown) {
  const maxAttempts = Number(job?.opts.attempts || 1);
  if (job && job.attemptsMade < maxAttempts) return;
  const data = job?.data && typeof job.data === 'object'
    ? job.data as Partial<PaymentAlertJob & PaymentConfirmationJob>
    : {};
  void reportWorkerError({
    component,
    message: errorMessage(error),
    jobId: job?.id ? String(job.id) : undefined,
    jobName: job?.name,
    attempt: job ? `${job.attemptsMade}/${maxAttempts}` : undefined,
    batchId: data.batchId,
    transactionId: data.transactionId,
    reference: data.reference,
  });
}

connection.on('error', (error) => {
  console.error('Worker Redis error:', errorMessage(error));
  void reportWorkerError({ component: 'redis', message: errorMessage(error) });
});

async function updateBatchStatus(batchId: string) {
  const transactions = await AppDataSource.getRepository(Transaction).find({
    where: { batch: { id: batchId } },
    select: ['status'],
  });
  const statuses = transactions.map((transaction) => transaction.status);
  let status: BatchStatus = 'processing';
  if (statuses.length && statuses.every((value) => value === 'succeeded')) status = 'completed';
  if (statuses.length && statuses.every((value) => value === 'simulated')) status = 'simulated';
  if (statuses.some((value) => value === 'failed') && statuses.every((value) => ['succeeded', 'failed'].includes(value))) {
    status = 'completed_with_errors';
  }
  await AppDataSource.getRepository(Batch).update({ id: batchId }, { status });
}

function providerMatches(transaction: Transaction, data: any) {
  try {
    return data?.reference === transaction.reference
      && String(data?.currency || '').toUpperCase() === transaction.currency
      && parseMinorUnits(String(data?.amount)) === parseMinorUnits(transaction.amount);
  } catch {
    return false;
  }
}

function providerError(error: unknown) {
  if (axios.isAxiosError(error)) {
    return {
      status: error.response?.status,
      message: error.message,
      data: error.response?.data,
    };
  }
  return { message: error instanceof Error ? error.message : 'Unknown payment error' };
}

function providerMessage(response: any) {
  return String(response?.data?.message || response?.message || '').trim() || undefined;
}

async function bootstrap() {
  validateRuntimeConfig('worker');
  if (getPaymentMode() === 'live') validateDiscordPaymentAlerts();
  await AppDataSource.initialize();

  const worker = new Worker('disburse', async (job) => {
    const { batchId, transactionId } = job.data as { batchId?: string; transactionId?: string };
    if (!batchId || !transactionId) throw new Error('Payment job is missing its database identifiers.');
    const txRepo = AppDataSource.getRepository(Transaction);
    const transaction = await AppDataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Transaction);
      const candidate = await repository.findOne({
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!candidate || candidate.batchId !== batchId || candidate.status !== 'pending') {
        return null;
      }
      candidate.status = 'processing';
      await repository.save(candidate);
      return candidate;
    });
    if (!transaction) return { ok: false, status: 'skipped' };

    if (!transaction.recipientEmail) {
      await txRepo.update(
        { id: transaction.id, status: 'processing' },
        { status: 'failed', providerResponse: { message: 'Recipient email is missing.' } as any },
      );
      await updateBatchStatus(batchId);
      await enqueuePaymentAlert({
        batchId,
        transactionId: transaction.id,
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status: 'failed',
        message: 'Recipient email is missing.',
      });
      return { ok: false, status: 'failed' };
    }

    const korapay = new KorapayService();
    try {
      if (korapay.mode === 'live') {
        await enqueuePaymentConfirmation({ batchId, transactionId: transaction.id });
      }
      const payout = {
        reference: transaction.reference,
        destination: {
          type: 'bank_account',
          amount: Number(transaction.amount),
          currency: transaction.currency,
          narration: transaction.narration?.trim() || `Payment to ${transaction.recipientName}`,
          bank_account: {
            bank: transaction.bankCode,
            account: transaction.accountNumber,
          },
          customer: {
            name: transaction.recipientName,
            email: transaction.recipientEmail,
          },
        },
      } as const;
      const response = await korapay.payout(payout);
      const providerStatus = response?.data?.status;
      const status = providerStatus === 'success'
        ? 'succeeded'
        : providerStatus === 'failed'
          ? 'failed'
          : providerStatus === 'simulated'
            ? 'simulated'
            : 'processing';
      await txRepo.update({ id: transaction.id, status: 'processing' }, { status, providerResponse: response });
      await updateBatchStatus(batchId);
      return { ok: response?.status !== false, status };
    } catch (error) {
      const httpStatus = axios.isAxiosError(error) ? error.response?.status : undefined;
      const status = httpStatus && httpStatus >= 400 && httpStatus < 500 ? 'failed' : 'pending_review';
      const providerResponse = providerError(error);
      await txRepo.update({ id: transaction.id, status: 'processing' }, { status, providerResponse: providerResponse as any });
      await updateBatchStatus(batchId);

      // Definite validation failures complete the job. Network/server errors fail the job
      // in an uncertain state and must be reconciled by reference before any manual retry.
      if (status === 'failed') {
        await enqueuePaymentAlert({
          batchId,
          transactionId: transaction.id,
          reference: transaction.reference,
          amount: transaction.amount,
          currency: transaction.currency,
          status,
          message: providerMessage((providerResponse as any).data) || providerResponse.message,
        });
        return { ok: false, status };
      }
      throw error;
    }
  }, { connection });

  const confirmationWorker = new Worker<PaymentConfirmationJob>(PAYMENT_CONFIRMATION_QUEUE, async (job) => {
    const { batchId, transactionId } = job.data;
    const txRepo = AppDataSource.getRepository(Transaction);
    const transaction = await txRepo.findOneBy({ id: transactionId });
    if (!transaction || transaction.batchId !== batchId) {
      throw new Error('Payment confirmation job does not match a transaction.');
    }

    const korapay = new KorapayService();
    if (korapay.mode !== 'live') return { ok: false, status: 'skipped' };

    try {
      const response = await korapay.getPayoutStatus(transaction.reference);
      const data = response?.data;
      if (!providerMatches(transaction, data)) {
        throw new Error('Kora confirmation did not match the transaction reference, amount, and currency.');
      }

      const status = data.status === 'success' ? 'succeeded' : data.status === 'failed' ? 'failed' : null;
      if (!status) throw new Error(`Kora payout is still ${String(data.status || 'processing')}.`);

      await txRepo.update({ id: transaction.id }, { status, providerResponse: response });
      await updateBatchStatus(batchId);
      await enqueuePaymentAlert({
        batchId,
        transactionId: transaction.id,
        reference: transaction.reference,
        amount: transaction.amount,
        currency: transaction.currency,
        status,
        message: providerMessage(response),
      });
      return { ok: true, status };
    } catch (error) {
      if (axios.isAxiosError(error)
        && error.response?.status === 404
        && error.response?.data?.code === 'AA026') {
        const errorResponse = providerError(error);
        await txRepo.update({ id: transaction.id }, { status: 'failed', providerResponse: errorResponse as any });
        await updateBatchStatus(batchId);
        await enqueuePaymentAlert({
          batchId,
          transactionId: transaction.id,
          reference: transaction.reference,
          amount: transaction.amount,
          currency: transaction.currency,
          status: 'failed',
          message: providerMessage((errorResponse as any).data) || 'Transaction not found in Kora.',
        });
        return { ok: true, status: 'failed' };
      }

      const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts || 1);
      if (finalAttempt) {
        const errorResponse = providerError(error);
        const latest = await txRepo.findOneBy({ id: transaction.id });
        if (latest && (latest.status === 'succeeded' || latest.status === 'failed')) {
          await enqueuePaymentAlert({
            batchId,
            transactionId: latest.id,
            reference: latest.reference,
            amount: latest.amount,
            currency: latest.currency,
            status: latest.status,
            message: 'Terminal status was received before confirmation retries ended.',
          });
        } else {
          await txRepo.update({ id: transaction.id }, { status: 'pending_review', providerResponse: errorResponse as any });
          await updateBatchStatus(batchId);
          await enqueuePaymentAlert({
            batchId,
            transactionId: transaction.id,
            reference: transaction.reference,
            amount: transaction.amount,
            currency: transaction.currency,
            status: 'pending_review',
            message: providerMessage((errorResponse as any).data) || errorResponse.message,
          });
        }
      }
      throw error;
    }
  }, { connection, concurrency: 5 });

  const alertWorker = new Worker<PaymentAlertJob>(PAYMENT_ALERT_QUEUE, async (job) => {
    await sendDiscordPaymentAlert(job.data);
    return { ok: true, status: job.data.status };
  }, { connection, concurrency: 2 });

  worker.on('completed', (job) => console.log('Completed', job.id));
  worker.on('failed', (job, error) => {
    console.error('Disbursement failed', job?.id, errorMessage(error));
    reportFinalJobFailure('disbursement-worker', job, error);
  });
  worker.on('error', (error) => {
    console.error('Disbursement worker error:', errorMessage(error));
    void reportWorkerError({ component: 'disbursement-worker', message: errorMessage(error) });
  });
  confirmationWorker.on('completed', (job) => console.log('Confirmation completed', job.id));
  confirmationWorker.on('failed', (job, error) => {
    console.error('Confirmation failed', job?.id, errorMessage(error));
    reportFinalJobFailure('confirmation-worker', job, error);
  });
  confirmationWorker.on('error', (error) => {
    console.error('Confirmation worker error:', errorMessage(error));
    void reportWorkerError({ component: 'confirmation-worker', message: errorMessage(error) });
  });
  alertWorker.on('completed', (job) => console.log('Discord alert sent', job.id));
  alertWorker.on('failed', (job, error) => {
    console.error('Discord alert failed', job?.id, errorMessage(error));
    reportFinalJobFailure('discord-alert-worker', job, error);
  });
  alertWorker.on('error', (error) => {
    console.error('Discord alert worker error:', errorMessage(error));
    void reportWorkerError({ component: 'discord-alert-worker', message: errorMessage(error) });
  });
  console.log('Worker started');
}

bootstrap().catch(async (error) => {
  console.error('Worker startup failed:', errorMessage(error));
  await reportWorkerError({ component: 'worker-startup', message: errorMessage(error) });
  process.exitCode = 1;
});
