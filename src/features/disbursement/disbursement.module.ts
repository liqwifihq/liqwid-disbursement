import { Module } from '@nestjs/common';
import { DisbursementService } from './disbursement.service';

@Module({
  providers: [DisbursementService],
  exports: [DisbursementService],
})
export class DisbursementModule {}
