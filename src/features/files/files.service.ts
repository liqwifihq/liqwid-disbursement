import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';
import { AppDataSource } from '../../ormconfig';
import { AuditLog } from '../../entities/audit.entity';
import { Batch } from '../../entities/batch.entity';
import { Transaction } from '../../entities/transaction.entity';
import { configuredLimit, formatMinorUnits, parseMinorUnits } from '../../utils/money';

const REQUIRED_COLUMNS = [
  'recipient_name',
  'recipient_email',
  'account_number',
  'bank_code',
  'amount',
  'currency',
] as const;

type UploadRow = Record<(typeof REQUIRED_COLUMNS)[number], string>;

type RowError = {
  row: number;
  fields: string[];
  message: string;
};

function normalizeRow(input: Record<string, unknown>): UploadRow {
  return Object.fromEntries(
    REQUIRED_COLUMNS.map((column) => [column, String(input[column] ?? '').trim()]),
  ) as UploadRow;
}

function validateRows(rows: UploadRow[]) {
  const rowErrors: RowError[] = [];
  const destinations = new Set<string>();
  const currencies = new Set<string>();
  const allowedCurrencies = new Set(
    (process.env.ALLOWED_CURRENCIES || 'NGN').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean),
  );
  const maxTransaction = configuredLimit('MAX_TRANSACTION_AMOUNT', '10000000.00');
  const maxBatch = configuredLimit('MAX_BATCH_AMOUNT', '100000000.00');
  let batchTotal = 0n;

  rows.forEach((row, index) => {
    const csvRow = index + 2;
    const missing = REQUIRED_COLUMNS.filter((column) => !row[column]);
    if (missing.length) {
      rowErrors.push({ row: csvRow, fields: [...missing], message: 'Required value is missing.' });
      return;
    }

    const invalid: string[] = [];
    try {
      const amount = parseMinorUnits(row.amount);
      if (amount > maxTransaction) invalid.push('amount');
      batchTotal += amount;
    } catch {
      invalid.push('amount');
    }
    if (!/^\d{10}$/.test(row.account_number)) {
      rowErrors.push({
        row: csvRow,
        fields: ['account_number'],
        message: accountNumberIssue(row.account_number),
      });
    }
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(row.bank_code)) invalid.push('bank_code');
    if (!/^[A-Za-z]{3}$/.test(row.currency) || !allowedCurrencies.has(row.currency.toUpperCase())) invalid.push('currency');
    if (row.recipient_name.length < 2 || row.recipient_name.length > 120) invalid.push('recipient_name');
    if (row.recipient_email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.recipient_email)) {
      invalid.push('recipient_email');
    }

    const destination = `${row.currency.toUpperCase()}:${row.bank_code.toUpperCase()}:${row.account_number}`;
    if (destinations.has(destination)) {
      rowErrors.push({
        row: csvRow,
        fields: ['bank_code', 'account_number'],
        message: 'This bank account is duplicated in the batch.',
      });
    }
    destinations.add(destination);
    currencies.add(row.currency.toUpperCase());

    if (invalid.length) {
      rowErrors.push({ row: csvRow, fields: invalid, message: 'One or more values have an invalid format.' });
    }
  });

  if (currencies.size > 1) {
    rowErrors.push({ row: 0, fields: ['currency'], message: 'A batch must contain a single currency.' });
  }
  if (batchTotal > maxBatch) {
    rowErrors.push({ row: 0, fields: ['amount'], message: `Batch total exceeds the configured ${formatMinorUnits(maxBatch)} limit.` });
  }

  return rowErrors;
}

function transactionReference(batchId: string, rowIndex: number) {
  const compactBatchId = batchId.replace(/-/g, '').toUpperCase();
  return `LQW-${compactBatchId}-${String(rowIndex + 1).padStart(4, '0')}`;
}

function accountNumberIssue(value: string) {
  if (!/^\d+$/.test(value)) return 'Account number must contain digits only and be exactly 10 digits.';
  if (value.length < 10) return `Account number is ${value.length} digit${value.length === 1 ? '' : 's'}; it must be exactly 10.`;
  return `Account number is ${value.length} digits; it must be exactly 10.`;
}

function normalizeBatchName(value?: string) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    throw new BadRequestException('Enter a batch name between 2 and 80 characters.');
  }
  return name;
}

@Injectable()
export class FilesService {
  parseAndPreview(file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose a CSV file to upload.');
    if (file.size === 0) throw new BadRequestException('The uploaded file is empty.');
    if (!file.originalname.toLowerCase().endsWith('.csv') && file.mimetype !== 'text/csv') {
      throw new BadRequestException('Only CSV files are supported.');
    }

    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim().toLowerCase(),
    });

    const headers = parsed.meta.fields || [];
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
    if (missingColumns.length) {
      throw new BadRequestException(`Missing CSV columns: ${missingColumns.join(', ')}`);
    }

    const rows = parsed.data.map(normalizeRow).map((row) => ({
      ...row,
      recipient_email: row.recipient_email.toLowerCase(),
      currency: row.currency.toUpperCase(),
    }));
    if (!rows.length) throw new BadRequestException('The CSV does not contain any data rows.');

    return {
      rows,
      rowErrors: validateRows(rows),
      parseErrors: parsed.errors.map((error) => ({
        row: typeof error.row === 'number' ? error.row + 2 : null,
        message: error.message,
      })),
    };
  }

  async createBatch(uploadedBy?: string, inputRows?: Record<string, unknown>[], batchName?: string) {
    const actor = String(uploadedBy || '').trim();
    const name = normalizeBatchName(batchName);
    if (!actor) throw new BadRequestException('Uploaded by is required.');
    if (!Array.isArray(inputRows) || inputRows.length === 0) {
      throw new BadRequestException('At least one transaction is required.');
    }
    if (inputRows.length > 5_000) throw new BadRequestException('A batch cannot exceed 5,000 rows.');

    const rows = inputRows.map(normalizeRow).map((row) => ({
      ...row,
      recipient_email: row.recipient_email.toLowerCase(),
      currency: row.currency.toUpperCase(),
    }));
    const rowErrors = validateRows(rows);
    if (rowErrors.length) throw new BadRequestException({ message: 'Fix invalid rows before creating a batch.', rowErrors });

    const totalInMinorUnits = rows.reduce((sum, row) => sum + parseMinorUnits(row.amount), 0n);

    try {
      return await AppDataSource.transaction(async (manager) => {
        const batchRepo = manager.getRepository(Batch);
        const txRepo = manager.getRepository(Transaction);
        const auditRepo = manager.getRepository(AuditLog);

        const batch = await batchRepo.save(batchRepo.create({
          name,
          uploadedBy: actor,
          totalAmount: formatMinorUnits(totalInMinorUnits),
          status: 'ready',
        }));
        const transactions = txRepo.create(rows.map((row, index) => ({
          batch,
          recipientName: row.recipient_name,
          recipientEmail: row.recipient_email,
          accountNumber: row.account_number,
          bankCode: row.bank_code,
          amount: formatMinorUnits(parseMinorUnits(row.amount)),
          currency: row.currency,
          reference: transactionReference(batch.id, index),
        })));
        await txRepo.save(transactions);
        await auditRepo.save(auditRepo.create({
          actor,
          action: 'create_batch',
          details: { batchId: batch.id, name, count: transactions.length },
        }));

        return { batchId: batch.id, count: transactions.length };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('A generated payment reference conflicted. Please create the batch again.');
      }
      throw error;
    }
  }
}
