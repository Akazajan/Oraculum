import { Module } from '@nestjs/common';
import { RefundCheckService } from './refund-check.service';

@Module({
  providers: [RefundCheckService],
  exports: [RefundCheckService],
})
export class RefundsModule {}
