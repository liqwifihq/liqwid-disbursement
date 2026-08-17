import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Transaction } from './transaction.entity';

export type BatchStatus = 'ready' | 'approved' | 'processing' | 'completed' | 'completed_with_errors' | 'simulated';

@Entity()
@Check(`"status" IN ('ready','approved','processing','completed','completed_with_errors','simulated')`)
export class Batch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  name: string | null;

  @Column()
  uploadedBy: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  totalAmount: string;

  @Column({ default: 'ready' })
  status: BatchStatus;

  @Column({ nullable: true })
  approvedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @OneToMany(() => Transaction, (transaction) => transaction.batch)
  transactions: Transaction[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
