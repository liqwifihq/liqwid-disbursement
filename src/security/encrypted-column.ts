import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ValueTransformer } from 'typeorm';
import { getDataEncryptionKey } from '../config';

const PREFIX = 'enc:v1:';

function encrypt(value: string) {
  if (!value || value.startsWith(PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getDataEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

function decrypt(value: string) {
  if (!value || !value.startsWith(PREFIX)) return value;
  const packed = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (packed.length < 29) throw new Error('Encrypted database value is malformed.');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getDataEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export const encryptedStringTransformer: ValueTransformer = {
  to: (value?: string | null) => value == null ? value : encrypt(value),
  from: (value?: string | null) => value == null ? value : decrypt(value),
};

export const encryptedJsonTransformer: ValueTransformer = {
  to: (value: unknown) => value == null
    ? value
    : typeof value === 'string' && value.startsWith(PREFIX)
      ? value
      : encrypt(JSON.stringify(value)),
  from: (value: unknown) => {
    if (value == null) return value;
    if (typeof value !== 'string') return value;
    return JSON.parse(decrypt(value));
  },
};
