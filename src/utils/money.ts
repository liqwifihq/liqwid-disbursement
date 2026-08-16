const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/;

export function parseMinorUnits(value: string) {
  const normalized = String(value || '').trim();
  const match = MONEY_PATTERN.exec(normalized);
  if (!match) throw new Error('Amount must be a positive decimal with no more than two decimal places.');
  const minorUnits = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (minorUnits <= 0n) throw new Error('Amount must be greater than zero.');
  return minorUnits;
}

export function formatMinorUnits(value: bigint) {
  const major = value / 100n;
  const minor = String(value % 100n).padStart(2, '0');
  return `${major}.${minor}`;
}

export function configuredLimit(name: 'MAX_TRANSACTION_AMOUNT' | 'MAX_BATCH_AMOUNT', fallback: string) {
  try {
    return parseMinorUnits(process.env[name] || fallback);
  } catch (error) {
    throw new Error(`${name} is invalid: ${error instanceof Error ? error.message : 'invalid amount'}`);
  }
}
