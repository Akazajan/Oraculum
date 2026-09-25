import { Injectable, BadRequestException } from '@nestjs/common';
import { InvoiceStatus } from '../enums/invoice-status.enum';

export interface StatusTransition {
  from: InvoiceStatus;
  to: InvoiceStatus;
}

@Injectable()
export class InvoiceStatusTransitionProvider {
  private readonly validTransitions: Map<InvoiceStatus, InvoiceStatus[]> = new Map([
    [InvoiceStatus.PENDING, [InvoiceStatus.PAID, InvoiceStatus.VOID]],
    [InvoiceStatus.PAID, [InvoiceStatus.VOID]],
    [InvoiceStatus.VOID, []],
  ]);

  validateTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    if (from === to) {
      return;
    }

    const allowed = this.validTransitions.get(from) ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid invoice status transition from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }
  }

  isValidTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
    if (from === to) return true;
    const allowed = this.validTransitions.get(from) ?? [];
    return allowed.includes(to);
  }

  getAllowedTransitions(from: InvoiceStatus): InvoiceStatus[] {
    return this.validTransitions.get(from) ?? [];
  }
}