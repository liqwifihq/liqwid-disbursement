import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  actor: string;

  @Column()
  action: string;

  @Column({ type: 'json', nullable: true })
  details: any;

  @CreateDateColumn()
  createdAt: Date;
}
