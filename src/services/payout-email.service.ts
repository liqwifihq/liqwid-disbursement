import * as fs from 'fs';
import * as path from 'path';
import { Resend } from 'resend';
import { getResendConfig } from '../config';
import { Transaction } from '../entities/transaction.entity';

const LOGO_CID = 'liqwifi-logo';
const INLINE_ASSETS = [
  { file: 'Liqwifi_CombMark_Duo_White.png', contentId: LOGO_CID },
  { file: 'icon-instagram.png', contentId: 'icon-instagram' },
  { file: 'icon-x.png', contentId: 'icon-x' },
  { file: 'icon-linkedin.png', contentId: 'icon-linkedin' },
  { file: 'icon-facebook.png', contentId: 'icon-facebook' },
  { file: 'badge-app-store.png', contentId: 'icon-app-store' },
  { file: 'badge-google-play.png', contentId: 'icon-google-play' },
  { file: 'footer-pattern.png', contentId: 'icon-footer-pattern' },
  { file: 'header-accent.png', contentId: 'icon-header-accent' },
] as const;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAmount(currency: string, amount: string) {
  const [major, minor = '00'] = String(amount).split('.');
  const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${grouped}.${minor.padEnd(2, '0').slice(0, 2)}`;
}

function maskAccount(accountNumber: string) {
  const digits = String(accountNumber || '').replace(/\D/g, '');
  const last4 = digits.slice(-4) || '••••';
  return `••••${last4}`;
}

function formatPaidAt(value = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(value);
}

function firstExisting(candidates: string[]) {
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function emailAssetPath(filename: string) {
  const found = firstExisting([
    path.join(process.cwd(), 'src', 'emails', 'assets', filename),
    path.join(process.cwd(), 'emails', 'assets', filename),
    path.join(__dirname, '..', 'emails', 'assets', filename),
    path.join(__dirname, 'assets', filename),
  ]);
  if (!found) throw new Error(`Email asset is missing: ${filename}`);
  return found;
}

export function assertPayoutEmailAssets() {
  payoutEmailTemplatePath();
  for (const asset of INLINE_ASSETS) emailAssetPath(asset.file);
}

function inlinePngAttachment(filename: string, contentId: string) {
  return {
    filename,
    content: fs.readFileSync(emailAssetPath(filename)).toString('base64'),
    contentType: 'image/png',
    contentId,
  };
}

function payoutEmailTemplatePath() {
  const found = firstExisting([
    path.join(__dirname, '..', 'emails', 'payout-success.html'),
    path.join(process.cwd(), 'src', 'emails', 'payout-success.html'),
    path.join(process.cwd(), 'emails', 'payout-success.html'),
  ]);
  if (!found) throw new Error('Payout email template is missing at src/emails/payout-success.html.');
  return found;
}

function replaceField(html: string, field: string, value: string) {
  const pattern = new RegExp(`<!-- \\{\\{${field}\\}\\} -->[\\s\\S]*?<!-- /\\{\\{${field}\\}\\} -->`, 'g');
  return html.replace(pattern, value);
}

function replaceBlock(html: string, field: string, innerHtml: string) {
  const pattern = new RegExp(`<!-- \\{\\{${field}\\}\\} -->[\\s\\S]*?<!-- /\\{\\{${field}\\}\\} -->`, 'g');
  return html.replace(pattern, innerHtml);
}

function buildHtmlEmail(input: {
  recipientName: string;
  amountLabel: string;
  reference: string;
  maskedAccount: string;
  paidAt: string;
  narration?: string;
  replyTo: string;
}) {
  let html = fs.readFileSync(payoutEmailTemplatePath(), 'utf8');
  html = html.replace(/src="[^"]+"(\s+data-email-logo="true")/g, `src="cid:${LOGO_CID}"$1`);
  html = html.replace(/src="[^"]+"(\s+data-email-icon="([^"]+)")/g, (_match, attrs, name) => `src="cid:icon-${name}"${attrs}`);
  html = replaceField(html, 'recipientName', escapeHtml(input.recipientName));
  html = replaceField(html, 'amountLabel', escapeHtml(input.amountLabel));
  html = replaceField(html, 'reference', escapeHtml(input.reference));
  html = replaceField(html, 'maskedAccount', escapeHtml(input.maskedAccount));
  html = replaceField(html, 'paidAt', escapeHtml(input.paidAt));
  html = replaceField(html, 'replyTo', escapeHtml(input.replyTo));
  html = html.replace(/href="mailto:[^"]+"/g, `href="mailto:${escapeHtml(input.replyTo)}"`);

  if (input.narration) {
    html = replaceField(html, 'narration', escapeHtml(input.narration));
  } else {
    html = replaceBlock(html, 'narrationRow', '');
  }
  return html;
}

function buildTextEmail(input: {
  recipientName: string;
  amountLabel: string;
  reference: string;
  maskedAccount: string;
  paidAt: string;
  narration?: string;
  replyTo: string;
}) {
  const lines = [
    `Hi ${input.recipientName},`,
    '',
    'A payment from Liqwid Finance has been sent to your bank account.',
    '',
    `Amount: ${input.amountLabel}`,
    `Reference: ${input.reference}`,
    `Destination: ${input.maskedAccount}`,
    `Date: ${input.paidAt}`,
  ];
  if (input.narration) lines.push(`Purpose: ${input.narration}`);
  lines.push(
    '',
    'Funds typically appear according to your bank’s processing time.',
    `If you have a question about this transaction, email ${input.replyTo} and include your reference number.`,
    '',
    'Download the Liqwifi app:',
    'App Store: https://apps.apple.com/app/liqwifi',
    'Google Play: https://play.google.com/store/apps/details?id=com.liqwifi.app',
    '',
    'Find us on socials:',
    'X: https://x.com/liqwifi',
    'Instagram: https://www.instagram.com/liqwifi',
    'LinkedIn: https://www.linkedin.com/company/liqwifi',
    'Facebook: https://www.facebook.com/liqwifi',
    '',
    'Liqwid Finance is committed to fast, secure transactions.',
    'Terms of service: https://www.liqwifi.com/legal/terms-of-service',
    'Privacy policy: https://www.liqwifi.com/legal/privacy-policy',
    '',
    'Copyright © 2026 Liqwid Finance. All rights reserved.',
  );
  return lines.join('\n');
}

export async function sendPayoutSuccessEmail(transaction: Transaction) {
  const email = String(transaction.recipientEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Recipient email is missing.');

  const config = getResendConfig();
  const amountLabel = formatAmount(transaction.currency, transaction.amount);
  const maskedAccount = maskAccount(transaction.accountNumber);
  const paidAt = formatPaidAt();
  const narration = transaction.narration?.trim() || undefined;
  const fields = {
    recipientName: transaction.recipientName,
    amountLabel,
    reference: transaction.reference,
    maskedAccount,
    paidAt,
    narration,
    replyTo: config.replyTo,
  };
  const resend = new Resend(config.apiKey);
  const { error } = await resend.emails.send({
    from: config.from,
    to: [email],
    replyTo: config.replyTo,
    subject: `Disbursement received — ${amountLabel}`,
    html: buildHtmlEmail(fields),
    text: buildTextEmail(fields),
    attachments: INLINE_ASSETS.map((asset) => inlinePngAttachment(asset.file, asset.contentId)),
  }, { idempotencyKey: `payout-email-v2-${transaction.id}` });

  if (error) throw new Error(error.message || 'Resend rejected the payout email.');
}
