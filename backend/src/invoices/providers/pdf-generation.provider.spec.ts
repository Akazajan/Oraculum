import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PdfGenerationProvider,
  isTransientPdfError,
  PDF_RETRY_MAX_ATTEMPTS,
} from './pdf-generation.provider';
import { PdfInvoiceProvider } from './pdf-invoice.provider';
import { PdfGenerationFallbackProvider } from './pdf-generation-fallback.provider';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  const inv = new Invoice();
  inv.id = '00000000-0000-0000-0000-000000000001';
  inv.invoiceNumber = 'INV-00001';
  inv.userId = '00000000-0000-0000-0000-000000000002';
  inv.bookingId = '00000000-0000-0000-0000-000000000003';
  inv.amountKobo = 50000;
  inv.currency = 'NGN';
  inv.status = InvoiceStatus.PAID;
  inv.lineItems = [];
  return Object.assign(inv, overrides);
}

describe('isTransientPdfError', () => {
  it('returns true for ECONNRESET', () => {
    const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    expect(isTransientPdfError(err)).toBe(true);
  });

  it('returns true for ETIMEDOUT', () => {
    const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    expect(isTransientPdfError(err)).toBe(true);
  });

  it('returns true for ECONNREFUSED', () => {
    const err = Object.assign(new Error('refused'), {
      code: 'ECONNREFUSED',
    });
    expect(isTransientPdfError(err)).toBe(true);
  });

  it('returns true for timeout in message', () => {
    expect(isTransientPdfError(new Error('request timeout'))).toBe(true);
  });

  it('returns true for connection reset in message', () => {
    expect(isTransientPdfError(new Error('Connection reset by peer'))).toBe(
      true,
    );
  });

  it('returns true for socket hang up in message', () => {
    expect(isTransientPdfError(new Error('socket hang up'))).toBe(true);
  });

  it('returns true for heap out of memory', () => {
    expect(
      isTransientPdfError(new Error('JavaScript heap out of memory')),
    ).toBe(true);
  });

  it('returns true for memory allocation failed', () => {
    expect(
      isTransientPdfError(new Error('memory allocation failed')),
    ).toBe(true);
  });

  it('returns false for non-retryable errors', () => {
    expect(isTransientPdfError(new Error('invalid invoice'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isTransientPdfError(null)).toBe(false);
    expect(isTransientPdfError(undefined)).toBe(false);
  });

  it('returns false for non-error objects', () => {
    expect(isTransientPdfError('string error')).toBe(false);
  });
});

describe('PdfGenerationProvider', () => {
  let provider: PdfGenerationProvider;
  let pdfInvoiceProvider: { generate: jest.Mock };
  let fallbackProvider: PdfGenerationFallbackProvider;

  beforeEach(async () => {
    pdfInvoiceProvider = { generate: jest.fn() };
    fallbackProvider = new PdfGenerationFallbackProvider();

    const mod = await Test.createTestingModule({
      providers: [
        PdfGenerationProvider,
        { provide: PdfInvoiceProvider, useValue: pdfInvoiceProvider },
        {
          provide: PdfGenerationFallbackProvider,
          useValue: fallbackProvider,
        },
      ],
    }).compile();

    provider = mod.get(PdfGenerationProvider);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns PDF buffer on first successful attempt', async () => {
    const buf = Buffer.from('pdf-content');
    pdfInvoiceProvider.generate.mockResolvedValue(buf);

    const result = await provider.generate(makeInvoice());
    expect(result).toBe(buf);
    expect(pdfInvoiceProvider.generate).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error then succeeds', async () => {
    const buf = Buffer.from('pdf-content');
    const transientErr = Object.assign(new Error('ECONNRESET'), {
      code: 'ECONNRESET',
    });

    pdfInvoiceProvider.generate
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValue(buf);

    const result = await provider.generate(makeInvoice());
    expect(result).toBe(buf);
    expect(pdfInvoiceProvider.generate).toHaveBeenCalledTimes(2);
    expect(fallbackProvider.getFailedQueue()).toHaveLength(0);
  });

  it('retries multiple times on transient errors', async () => {
    const buf = Buffer.from('pdf-content');
    const transientErr = Object.assign(new Error('timeout'), {
      code: 'ETIMEDOUT',
    });

    pdfInvoiceProvider.generate
      .mockRejectedValueOnce(transientErr)
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValue(buf);

    const result = await provider.generate(makeInvoice());
    expect(result).toBe(buf);
    expect(pdfInvoiceProvider.generate).toHaveBeenCalledTimes(3);
  });

  it('queues permanent failure and returns an actionable error', async () => {
    const transientErr = Object.assign(new Error('timeout'), {
      code: 'ETIMEDOUT',
    });
    pdfInvoiceProvider.generate.mockRejectedValue(transientErr);

    const invoice = makeInvoice();
    const generation = provider.generate(invoice);
    await expect(generation).rejects.toThrow(ServiceUnavailableException);
    await expect(generation).rejects.toThrow(/queued for retry.*reference/i);

    expect(pdfInvoiceProvider.generate).toHaveBeenCalledTimes(
      PDF_RETRY_MAX_ATTEMPTS,
    );
    const queue = fallbackProvider.getFailedQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].invoiceId).toBe(invoice.id);
    expect(queue[0].invoiceNumber).toBe('INV-00001');
    expect(queue[0].attemptCount).toBe(PDF_RETRY_MAX_ATTEMPTS);
    expect(queue[0].correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('does not retry on non-transient error', async () => {
    pdfInvoiceProvider.generate.mockRejectedValue(
      new Error('invalid invoice data'),
    );

    const invoice = makeInvoice();
    await expect(provider.generate(invoice)).rejects.toThrow(
      ServiceUnavailableException,
    );

    expect(pdfInvoiceProvider.generate).toHaveBeenCalledTimes(1);
    const queue = fallbackProvider.getFailedQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].attemptCount).toBe(1);
  });

  it('does not return an empty buffer as a successful PDF', async () => {
    pdfInvoiceProvider.generate.mockResolvedValue(Buffer.alloc(0));

    await expect(provider.generate(makeInvoice())).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fallbackProvider.getFailedQueue()).toHaveLength(1);
  });

  it('returns an actionable error and logs only a reference when fallback fails', async () => {
    const invoice = makeInvoice();
    pdfInvoiceProvider.generate.mockRejectedValue(
      new Error('sensitive invoice details'),
    );
    jest
      .spyOn(fallbackProvider, 'handlePermanentFailure')
      .mockImplementation(() => {
        throw new Error('fallback internals');
      });
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    let thrown: unknown;
    try {
      await provider.generate(invoice);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect(thrown).toMatchObject({
      message: expect.stringMatching(
        /Retry later or contact support with reference [0-9a-f-]+/i,
      ),
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logMessage = logSpy.mock.calls[0][0] as string;
    expect(logMessage).toMatch(/reference [0-9a-f-]+/i);
    expect(logMessage).not.toContain(invoice.id);
    expect(logMessage).not.toContain(invoice.invoiceNumber);
    expect(logMessage).not.toContain('sensitive invoice details');
    expect(logMessage).not.toContain('fallback internals');
  });
});

describe('PdfGenerationFallbackProvider', () => {
  let provider: PdfGenerationFallbackProvider;

  beforeEach(() => {
    provider = new PdfGenerationFallbackProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues failure on handlePermanentFailure', () => {
    const invoice = makeInvoice();
    const correlationId = 'correlation-123';
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    provider.handlePermanentFailure(
      invoice,
      new Error('boom'),
      3,
      correlationId,
    );

    const queue = provider.getFailedQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].invoiceId).toBe(invoice.id);
    expect(queue[0].invoiceNumber).toBe('INV-00001');
    expect(queue[0].userId).toBe(invoice.userId);
    expect(queue[0].error).toBe('boom');
    expect(queue[0].attemptCount).toBe(3);
    expect(queue[0].failedAt).toBeInstanceOf(Date);
    expect(queue[0].correlationId).toBe(correlationId);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(correlationId));
    const logMessage = logSpy.mock.calls[0][0] as string;
    expect(logMessage).not.toContain(invoice.id);
    expect(logMessage).not.toContain(invoice.invoiceNumber);
    expect(logMessage).not.toContain(invoice.userId);
    expect(logMessage).not.toContain('boom');
  });

  it('removeFromQueue removes and returns the failure', () => {
    const invoice = makeInvoice();
    provider.handlePermanentFailure(invoice, new Error('fail'), 1);

    const removed = provider.removeFromQueue(invoice.id);
    expect(removed).toBeDefined();
    expect(removed!.invoiceId).toBe(invoice.id);
    expect(provider.getFailedQueue()).toHaveLength(0);
  });

  it('removeFromQueue returns undefined for unknown id', () => {
    expect(
      provider.removeFromQueue('00000000-0000-0000-0000-000000000099'),
    ).toBeUndefined();
  });

  it('handles multiple failures', () => {
    const inv1 = makeInvoice({ id: 'id-1', invoiceNumber: 'INV-00001' });
    const inv2 = makeInvoice({ id: 'id-2', invoiceNumber: 'INV-00002' });

    provider.handlePermanentFailure(inv1, new Error('err1'), 1);
    provider.handlePermanentFailure(inv2, new Error('err2'), 2);

    expect(provider.getFailedQueue()).toHaveLength(2);

    provider.removeFromQueue('id-1');
    expect(provider.getFailedQueue()).toHaveLength(1);
    expect(provider.getFailedQueue()[0].invoiceId).toBe('id-2');
  });
});