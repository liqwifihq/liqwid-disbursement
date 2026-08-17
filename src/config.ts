export type PaymentMode = 'simulation' | 'live';

function required(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function getPaymentMode(): PaymentMode {
  const mode = String(process.env.PAYMENT_MODE || '').trim().toLowerCase();
  if (mode !== 'simulation' && mode !== 'live') {
    throw new Error('PAYMENT_MODE must be explicitly set to "simulation" or "live".');
  }
  return mode;
}

export function getInternalApiToken() {
  const token = required('INTERNAL_API_TOKEN');
  if (token.length < 32) throw new Error('INTERNAL_API_TOKEN must contain at least 32 characters.');
  return token;
}

export function getDataEncryptionKey() {
  const encoded = required('DATA_ENCRYPTION_KEY');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('DATA_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.');
  }
  return key;
}

export function getKoraConfig() {
  const mode = getPaymentMode();
  const baseUrl = new URL(process.env.KORAPAY_BASE_URL || 'https://api.korapay.com');
  const secret = String(process.env.KORAPAY_SECRET || '').trim();

  if (mode === 'live') {
    if (baseUrl.protocol !== 'https:') throw new Error('Provider-connected Kora requests require an HTTPS base URL.');
    const allowedHosts = (process.env.KORAPAY_ALLOWED_HOSTS || 'api.korapay.com')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (!allowedHosts.includes(baseUrl.hostname.toLowerCase())) {
      throw new Error(`KORAPAY_BASE_URL host ${baseUrl.hostname} is not allowlisted.`);
    }
    if (secret.length < 24) {
      throw new Error('KORAPAY_SECRET must contain a Kora test or live secret when PAYMENT_MODE is "live".');
    }
  }

  return { mode, baseUrl: baseUrl.toString().replace(/\/$/, ''), secret };
}

function emailAddress(value: string, name: string) {
  const named = /^.+\s<([^<>]+)>$/.exec(value);
  const address = (named ? named[1] : value).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) {
    throw new Error(`${name} must be a valid email address.`);
  }
  return value;
}

export function getResendConfig() {
  const apiKey = required('RESEND_API_KEY');
  if (apiKey.length < 20) throw new Error('RESEND_API_KEY is invalid.');

  const from = emailAddress(required('RESEND_FROM'), 'RESEND_FROM');
  const replyTo = emailAddress(
    String(process.env.RESEND_REPLY_TO || 'hello@liqwifi.com').trim(),
    'RESEND_REPLY_TO',
  );

  return { apiKey, from, replyTo };
}

export function validateRuntimeConfig(component: 'api' | 'worker') {
  required('DATABASE_URL');
  required('REDIS_URL');
  getKoraConfig();
  getDataEncryptionKey();
  if (component === 'api') getInternalApiToken();
  if (component === 'worker' && getPaymentMode() === 'live') getResendConfig();

  if (process.env.NODE_ENV === 'production' && process.env.TYPEORM_SYNCHRONIZE !== 'false') {
    throw new Error('TYPEORM_SYNCHRONIZE must be false in production. Use reviewed migrations.');
  }
}
