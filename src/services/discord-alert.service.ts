import axios from 'axios';
import type { PaymentAlertJob } from '../queues/payment-queues';

const DISCORD_WEBHOOK_HOSTS = new Set([
  'discord.com',
  'canary.discord.com',
  'ptb.discord.com',
  'discordapp.com',
]);

function webhookUrl(status: PaymentAlertJob['status']) {
  const variable = status === 'succeeded'
    ? 'DISCORD_SUCCESS_WEBHOOK_URL'
    : 'DISCORD_FAILURE_WEBHOOK_URL';
  const value = String(process.env[variable] || '').trim();
  if (!value) throw new Error(`${variable} is not configured.`);

  const url = new URL(value);
  if (url.protocol !== 'https:' || !DISCORD_WEBHOOK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`${variable} must be an HTTPS Discord webhook URL.`);
  }
  if (!/^\/api\/webhooks\/\d+\/[^/]+/.test(url.pathname)) {
    throw new Error(`${variable} does not have a valid Discord webhook path.`);
  }
  return url.toString();
}

export function validateDiscordPaymentAlerts() {
  const successUrl = webhookUrl('succeeded');
  const failureUrl = webhookUrl('failed');
  if (successUrl === failureUrl) {
    throw new Error('Success and failure alerts must use different Discord webhook URLs.');
  }
}

export async function sendDiscordPaymentAlert(alert: PaymentAlertJob) {
  const successful = alert.status === 'succeeded';
  const title = successful
    ? 'Payment confirmed'
    : alert.status === 'failed'
      ? 'Payment failed'
      : 'Payment confirmation needs review';

  await axios.post(webhookUrl(alert.status), {
    username: 'LiqWiFi Payments',
    allowed_mentions: { parse: [] },
    embeds: [{
      title,
      color: successful ? 0x16a34a : alert.status === 'failed' ? 0xdc2626 : 0xd97706,
      fields: [
        { name: 'Reference', value: alert.reference, inline: false },
        { name: 'Amount', value: `${alert.currency} ${alert.amount}`, inline: true },
        { name: 'Status', value: alert.status, inline: true },
        { name: 'Batch', value: alert.batchId, inline: false },
        ...(alert.message ? [{ name: 'Provider message', value: alert.message.slice(0, 500), inline: false }] : []),
      ],
      timestamp: new Date().toISOString(),
    }],
  }, { timeout: 15_000 });
}

export type WorkerErrorAlert = {
  component: string;
  message: string;
  jobId?: string;
  jobName?: string;
  attempt?: string;
  batchId?: string;
  transactionId?: string;
  reference?: string;
};

export async function sendDiscordWorkerErrorAlert(alert: WorkerErrorAlert) {
  const fields = [
    { name: 'Component', value: alert.component.slice(0, 100), inline: true },
    ...(alert.jobName ? [{ name: 'Job', value: alert.jobName.slice(0, 100), inline: true }] : []),
    ...(alert.attempt ? [{ name: 'Attempt', value: alert.attempt.slice(0, 50), inline: true }] : []),
    ...(alert.jobId ? [{ name: 'Job ID', value: alert.jobId.slice(0, 200), inline: false }] : []),
    ...(alert.batchId ? [{ name: 'Batch', value: alert.batchId.slice(0, 200), inline: false }] : []),
    ...(alert.transactionId ? [{ name: 'Transaction', value: alert.transactionId.slice(0, 200), inline: false }] : []),
    ...(alert.reference ? [{ name: 'Reference', value: alert.reference.slice(0, 200), inline: false }] : []),
    { name: 'Error', value: alert.message.slice(0, 1000), inline: false },
  ];

  await axios.post(webhookUrl('failed'), {
    username: 'LiqWiFi Workers',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: 'Background worker error',
      color: 0xdc2626,
      fields,
      timestamp: new Date().toISOString(),
    }],
  }, { timeout: 15_000 });
}
