import { Injectable, Logger } from '@nestjs/common';
import { Invoice } from '../entities/invoice.entity';
import { PdfInvoiceProvider } from './pdf-invoice.provider';
import { PdfGenerationFallbackProvider } from './pdf-generation-fallback.provider';
import { withRetry } from '../../utils/retry.util';

export const PDF_RETRY_MAX_ATTEMPTS = 3;
export const PDF_RETRY_BASE_DELAY_MS = 500;
export const PDF_RETRY_MAX_DELAY_MS = 5_000;

export function isTransientPdfError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as {
    code?: string;
    message?: string;
    name?: string;
  };

  const transientCodes = [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EPIPE',
    'EAI_AGAIN',
    'ENOTFOUND',
    'SOCKET_TIMEOUT',
  ];

  if (err.code && transientCodes.includes(err.code)) {
    return true;
  }

  if (err.message) {
    const msg = err.message.toLowerCase();
    const transientPatterns = [
      'timeout',
      'connection reset',
      'socket hang up',
      'econnreset',
      'etimedout',
      'heap',
      'out of memory',
      'memory allocation failed',
    ];
    if (transientPatterns.some((p) => msg.includes(p))) {
      return true;
    }
  }

  if (err.name === 'RangeError' || err.name === 'InternalError') {
    const msg = err.message?.toLowerCase() ?? '';
    if (msg.includes('heap') || msg.includes('memory')) {
      return true;
    }
  }

  return false;
}

@Injectable()
export class PdfGenerationProvider {
  private readonly logger = new Logger(PdfGenerationProvider.name);

  constructor(
    private readonly pdfInvoiceProvider: PdfInvoiceProvider,
    private readonly fallbackProvider: PdfGenerationFallbackProvider,
  ) {}

  async generate(invoice: Invoice): Promise<Buffer> {
    try {
      return await withRetry(
        () => this.pdfInvoiceProvider.generate(invoice),
        {
          maxAttempts: PDF_RETRY_MAX_ATTEMPTS,
          baseDelayMs: PDF_RETRY_BASE_DELAY_MS,
          maxDelayMs: PDF_RETRY_MAX_DELAY_MS,
          isRetryable: isTransientPdfError,
          onRetry: (error, attempt, nextDelayMs) => {
            this.logger.warn(
              `PDF generation attempt ${attempt} failed for invoice ` +
                `${invoice.invoiceNumber}: ${(error as Error).message}. ` +
                `Retrying in ${nextDelayMs}ms...`,
            );
          },
        },
      );
    } catch (error) {
      this.fallbackProvider.handlePermanentFailure(
        invoice,
        error,
        PDF_RETRY_MAX_ATTEMPTS,
      );
      throw error;
    }
  }
}