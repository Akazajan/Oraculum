import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class RefundCheckService {
  async checkEligibility(bookingId: string): Promise<boolean> {
    return true;
  }

  /**
   * B50 — Validates a refund amount against the captured payment amount.
   * Negative and excessive values fail; valid partial refunds are
   * supported. The running refunded amount is passed in so repeated
   * full refunds cannot exceed the original capture.
   */
  validateRefundAmount(
    requestedAmount: number,
    capturedAmount: number,
    alreadyRefunded: number = 0,
  ): void {
    if (!Number.isFinite(requestedAmount)) {
      throw new BadRequestException('Refund amount must be a finite number.');
    }

    if (requestedAmount <= 0) {
      throw new BadRequestException(
        'Refund amount must be greater than zero.',
      );
    }

    if (!Number.isFinite(capturedAmount) || capturedAmount <= 0) {
      throw new BadRequestException(
        'Captured payment amount is invalid.',
      );
    }

    const remaining = capturedAmount - alreadyRefunded;
    if (requestedAmount > remaining) {
      throw new BadRequestException(
        `Refund amount exceeds the captured payment amount. Remaining refundable: ${remaining}`,
      );
    }
  }

  async addRefundReason(bookingId: string, reason: string): Promise<void> {}

  getRefundReasons(): string[] {
    return ['customer_request', 'technical_issue', 'duplicate_booking'];
  }
}
