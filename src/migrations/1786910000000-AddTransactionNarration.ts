import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionNarration1786910000000 implements MigrationInterface {
  name = 'AddTransactionNarration1786910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transaction"
      ADD COLUMN "narration" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transaction"
      DROP COLUMN "narration"
    `);
  }
}
