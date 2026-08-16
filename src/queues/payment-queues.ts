import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const PAYMENT_CONFIRMATION_QUEUE = 'confirm-disbursement';
export const PAYMENT_ALERT_QUEUE = 'payment-discord-alert';

export type PaymentConfirmationJob = {
  batchId: string;
  transactionId: string;
};

export type PaymentAlertStatus = 'succeeded' | 'failed' | 'pending_review';

export type PaymentAlertJob = {
  batchId: string;
  transactionId: string;
  reference: string;
  amount: string;
  currency: string;
  status: PaymentAlertStatus;
  message?: string;
};

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const confirmationQueue = new Queue<PaymentConfirmationJob>(PAYMENT_CONFIRMATION_QUEUE, { connection });
const alertQueue = new Queue<PaymentAlertJob>(PAYMENT_ALERT_QUEUE, { connection });

export async function enqueuePaymentConfirmation(data: PaymentConfirmationJob) {
  return confirmationQueue.add('confirm-payment', data, {
    jobId: `payment-confirmation-${data.transactionId}`,
    delay: 60_000,
    attempts: 15,
    backoff: { type: 'fixed', delay: 60_000 },
    removeOnComplete: 10_000,
    removeOnFail: 10_000,
  });
}

export async function enqueuePaymentAlert(data: PaymentAlertJob) {
  return alertQueue.add('send-payment-alert', data, {
    jobId: `payment-alert-${data.status}-${data.transactionId}`,
    attempts: 8,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 10_000,
    removeOnFail: 10_000,
  });
}
