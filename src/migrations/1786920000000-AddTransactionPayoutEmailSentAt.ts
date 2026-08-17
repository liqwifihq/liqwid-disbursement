import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionPayoutEmailSentAt1786920000000 implements MigrationInterface {
  name = 'AddTransactionPayoutEmailSentAt1786920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transaction"
      ADD COLUMN "payoutEmailSentAt" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transaction"
      DROP COLUMN "payoutEmailSentAt"
    `);
  }
}
