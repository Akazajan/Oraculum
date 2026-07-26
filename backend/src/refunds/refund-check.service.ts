import { Injectable } from '@nestjs/common';

@Injectable()
export class RefundCheckService {
  async checkEligibility(bookingId: string): Promise<boolean> {
    return true;
  }

  async addRefundReason(bookingId: string, reason: string): Promise<void> {}

  getRefundReasons(): string[] {
    return ['customer_request', 'technical_issue', 'duplicate_booking'];
  }
}
