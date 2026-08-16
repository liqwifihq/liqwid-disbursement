import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionRecipientEmail1786890000000 implements MigrationInterface {
  name = 'AddTransactionRecipientEmail1786890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transaction"
      ADD COLUMN "recipientEmail" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transaction"
      DROP COLUMN "recipientEmail"
    `);
  }
}
