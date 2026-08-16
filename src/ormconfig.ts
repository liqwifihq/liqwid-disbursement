import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { AuditLog } from './entities/audit.entity';
import { Batch } from './entities/batch.entity';
import { Transaction } from './entities/transaction.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: process.env.NODE_ENV !== 'production' && process.env.TYPEORM_SYNCHRONIZE === 'true',
  entities: [AuditLog, Batch, Transaction],
  migrations: [`${__dirname}/migrations/*.{js,ts}`],
});
