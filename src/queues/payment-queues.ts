import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getPaymentMode } from '../config';

export const PAYMENT_CONFIRMATION_QUEUE = 'confirm-disbursement';
export const PAYMENT_ALERT_QUEUE = 'payment-discord-alert';
export const PAYOUT_EMAIL_QUEUE = 'payout-recipient-email';

export type PaymentConfirmationJob = {
  batchId: string;
  transactionId: string;
};

export type PayoutEmailJob = {
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
const payoutEmailQueue = new Queue<PayoutEmailJob>(PAYOUT_EMAIL_QUEUE, { connection });

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

export async function enqueuePayoutSuccessEmail(data: PayoutEmailJob) {
  if (getPaymentMode() !== 'live') return;
  try {
    return await payoutEmailQueue.add('send-payout-email', data, {
      jobId: `payout-email-${data.transactionId}`,
      attempts: 8,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 10_000,
      removeOnFail: 10_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists/i.test(message)) return;
    throw error;
  }
}
