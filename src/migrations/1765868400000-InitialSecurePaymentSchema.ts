import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSecurePaymentSchema1765868400000 implements MigrationInterface {
  name = 'InitialSecurePaymentSchema1765868400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(`
      CREATE TABLE "batch" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "uploadedBy" character varying NOT NULL,
        "totalAmount" numeric(18,2) NOT NULL,
        "status" character varying NOT NULL DEFAULT 'ready',
        "approvedBy" character varying,
        "approvedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_batch_status" CHECK ("status" IN ('ready','approved','processing','completed','completed_with_errors','simulated')),
        CONSTRAINT "PK_batch" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "transaction" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recipientName" character varying NOT NULL,
        "accountNumber" character varying NOT NULL,
        "bankCode" character varying NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "currency" character varying NOT NULL,
        "reference" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "beneficiaryVerified" boolean NOT NULL DEFAULT false,
        "resolvedAccountName" character varying,
        "beneficiaryVerifiedAt" TIMESTAMP WITH TIME ZONE,
        "providerRequest" text,
        "providerResponse" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "batchId" uuid NOT NULL,
        CONSTRAINT "UQ_transaction_reference" UNIQUE ("reference"),
        CONSTRAINT "CHK_transaction_status" CHECK ("status" IN ('pending','processing','pending_review','succeeded','failed','simulated')),
        CONSTRAINT "PK_transaction" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transaction_batch" FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor" character varying NOT NULL,
        "action" character varying NOT NULL,
        "details" json,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_transaction_batch_status" ON "transaction" ("batchId", "status")');
    await queryRunner.query('CREATE INDEX "IDX_audit_batch_time" ON "audit_log" (("details"->>\'batchId\'), "createdAt")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_audit_batch_time"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_transaction_batch_status"');
    await queryRunner.query('DROP TABLE IF EXISTS "audit_log"');
    await queryRunner.query('DROP TABLE IF EXISTS "transaction"');
    await queryRunner.query('DROP TABLE IF EXISTS "batch"');
  }
}
