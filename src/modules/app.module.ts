import { Module } from '@nestjs/common';
import { FilesModule } from '../features/files/files.module';
import { DisbursementModule } from '../features/disbursement/disbursement.module';
import { WebhooksController } from '../features/webhooks/webhooks.controller';
import { BatchesController } from '../features/batches/batches.controller';
import { ReconcileController } from '../features/reconcile/reconcile.controller';

@Module({
  imports: [FilesModule, DisbursementModule],
  controllers: [WebhooksController, BatchesController, ReconcileController],
})
export class AppModule {}
