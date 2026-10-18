import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Invoice } from '../entities/invoice.entity';
import { PdfInvoiceProvider } from './pdf-invoice.provider';
import { PdfGenerationFallbackProvider } from './pdf-generation-fallback.provider';
import { withRetry } from '../../utils/retry.util';
import { randomUUID } from 'node:crypto';

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
    const correlationId = randomUUID();
    let attemptCount = 0;

    try {
      return await withRetry(
        async () => {
          attemptCount += 1;
          const pdf = await this.pdfInvoiceProvider.generate(invoice);
          if (!Buffer.isBuffer(pdf) || pdf.length === 0) {
            throw new Error('PDF generator returned an empty document');
          }
          return pdf;
        },
        {
          maxAttempts: PDF_RETRY_MAX_ATTEMPTS,
          baseDelayMs: PDF_RETRY_BASE_DELAY_MS,
          maxDelayMs: PDF_RETRY_MAX_DELAY_MS,
          isRetryable: isTransientPdfError,
          onRetry: (_error, attempt, nextDelayMs) => {
            this.logger.warn(
              `PDF generation attempt ${attempt} failed ` +
                `(reference ${correlationId}). Retrying in ${nextDelayMs}ms...`,
            );
          },
        },
      );
    } catch (error) {
      try {
        this.fallbackProvider.handlePermanentFailure(
          invoice,
          error,
          attemptCount,
          correlationId,
        );
      } catch {
        this.logger.error(
          `PDF generation and fallback handling failed (reference ${correlationId})`,
        );
        throw new ServiceUnavailableException(
          `Invoice PDF is unavailable. Retry later or contact support with reference ${correlationId}.`,
        );
      }

      throw new ServiceUnavailableException(
        `Invoice PDF is unavailable and has been queued for retry. Contact support with reference ${correlationId} if the problem continues.`,
      );
    }
  }
}