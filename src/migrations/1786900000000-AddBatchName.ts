import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchName1786900000000 implements MigrationInterface {
  name = 'AddBatchName1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "batch"
      ADD COLUMN "name" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "batch"
      DROP COLUMN "name"
    `);
  }
}
