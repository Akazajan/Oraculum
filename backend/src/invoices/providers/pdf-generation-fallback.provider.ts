import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Invoice } from '../entities/invoice.entity';

export interface PdfRetryFailure {
  invoiceId: string;
  invoiceNumber: string;
  userId: string;
  error: string;
  failedAt: Date;
  attemptCount: number;
  correlationId: string;
}

@Injectable()
export class PdfGenerationFallbackProvider {
  private readonly logger = new Logger(PdfGenerationFallbackProvider.name);
  private readonly failedQueue: PdfRetryFailure[] = [];

  handlePermanentFailure(
    invoice: Invoice,
    error: unknown,
    attemptCount: number,
    correlationId = randomUUID(),
  ): void {
    const failure: PdfRetryFailure = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      userId: invoice.userId,
      error: error instanceof Error ? error.message : String(error),
      failedAt: new Date(),
      attemptCount,
      correlationId,
    };

    this.failedQueue.push(failure);

    this.logger.error(
      `PDF generation permanently failed after ${attemptCount} attempts. ` +
        `Queued for manual retry (reference ${correlationId}).`,
    );
  }

  getFailedQueue(): readonly PdfRetryFailure[] {
    return this.failedQueue;
  }

  removeFromQueue(invoiceId: string): PdfRetryFailure | undefined {
    const idx = this.failedQueue.findIndex((f) => f.invoiceId === invoiceId);
    if (idx === -1) return undefined;
    return this.failedQueue.splice(idx, 1)[0];
  }
}