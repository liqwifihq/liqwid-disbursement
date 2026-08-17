import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, Check, RelationId } from 'typeorm';
import { Batch } from './batch.entity';
import { encryptedJsonTransformer, encryptedStringTransformer } from '../security/encrypted-column';

@Entity()
@Check(`"status" IN ('pending','processing','pending_review','succeeded','failed','simulated')`)
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Batch, (b) => b.transactions, { nullable: false, onDelete: 'CASCADE' })
  batch: Batch;

  @RelationId((transaction: Transaction) => transaction.batch)
  batchId: string;

  @Column()
  recipientName: string;

  @Column({ nullable: true })
  recipientEmail: string | null;

  @Column({ transformer: encryptedStringTransformer })
  accountNumber: string;

  @Column()
  bankCode: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column()
  currency: string;

  @Column({ unique: true })
  reference: string;

  @Column({ nullable: true })
  narration: string | null;

  @Column({ default: 'pending' })
  status: string;

  @Column({ default: false })
  beneficiaryVerified: boolean;

  @Column({ nullable: true })
  resolvedAccountName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  beneficiaryVerifiedAt: Date | null;

  @Column({ type: 'text', nullable: true, select: false, transformer: encryptedJsonTransformer })
  providerRequest: any;

  @Column({ type: 'text', nullable: true, select: false, transformer: encryptedJsonTransformer })
  providerResponse: any;

  @CreateDateColumn()
  createdAt: Date;
}
