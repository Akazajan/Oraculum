import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { GenerateInvoiceProvider } from './generate-invoice.provider';
import { InvoiceSequenceProvider } from './invoice-sequence.provider';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../../payments/entities/payment.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { User } from '../../users/entities/user.entity';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { EmailService } from '../../email/email.service';
import { PdfGenerationProvider } from './pdf-generation.provider';

const PAYMENT = {
  id: 'payment-1',
  userId: 'user-1',
  bookingId: 'booking-1',
  amount: 250000,
  currency: 'NGN',
  paidAt: new Date('2026-01-02T03:04:05Z'),
};

const USER = {
  id: 'user-1',
  email: 'jane@example.com',
  fullName: 'Jane Doe',
};

/** In-memory stand-in for the unique indexes on `invoices`. */
class FakeInvoiceTable {
  rows: Partial<Invoice>[] = [];

  insert(row: Partial<Invoice>): Partial<Invoice> {
    if (
      this.rows.some((existing) => existing.invoiceNumber === row.invoiceNumber)
    ) {
      throw Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'IDX_invoices_invoice_number_unique',
      });
    }
    if (
      row.paymentId &&
      this.rows.some((existing) => existing.paymentId === row.paymentId)
    ) {
      throw Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'IDX_invoices_payment_id_unique',
      });
    }
    const stored = { ...row, id: `invoice-${this.rows.length + 1}` };
    this.rows.push(stored);
    return stored;
  }

  findByPaymentId(paymentId: string): Partial<Invoice> | undefined {
    return this.rows.find((row) => row.paymentId === paymentId);
  }
}

describe('GenerateInvoiceProvider (BE-51 — atomic invoice-number allocation)', () => {
  let provider: GenerateInvoiceProvider;
  let table: FakeInvoiceTable;
  let nextNumber: number;
  let sequenceProvider: { nextInvoiceNumber: jest.Mock };
  let emailService: { sendInvoiceReadyEmail: jest.Mock };
  let pdfGenerationProvider: { generate: jest.Mock };
  let existingLookup: jest.Mock;
  let transactionCount: number;

  beforeEach(async () => {
    table = new FakeInvoiceTable();
    transactionCount = 0;
    nextNumber = 1;

    sequenceProvider = {
      nextInvoiceNumber: jest.fn(async () => {
        const value = nextNumber++;
        return `INV-${String(value).padStart(5, '0')}`;
      }),
    };

    emailService = { sendInvoiceReadyEmail: jest.fn().mockResolvedValue(true) };
    pdfGenerationProvider = {
      generate: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    };

    existingLookup = jest.fn(
      async ({ where }: { where: { paymentId?: string } }) =>
        where.paymentId
          ? (table.findByPaymentId(where.paymentId) ?? null)
          : null,
    );

    const manager = {
      create: (_entity: unknown, data: Partial<Invoice>) => data,
      save: async (data: Partial<Invoice>) => table.insert(data),
    };

    const dataSource = {
      transaction: async (work: (m: typeof manager) => Promise<unknown>) => {
        transactionCount++;
        return work(manager);
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GenerateInvoiceProvider,
        {
          provide: getRepositoryToken(Invoice),
          useValue: { findOne: existingLookup },
        },
        {
          provide: getRepositoryToken(Payment),
          // Echo the requested id back so each caller invoices its own payment.
          useValue: {
            findOne: jest.fn(async ({ where }: { where: { id: string } }) => ({
              ...PAYMENT,
              id: where.id,
            })),
          },
        },
        {
          provide: getRepositoryToken(Booking),
          useValue: { findOne: jest.fn(async () => null) },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn(async () => USER) },
        },
        {
          provide: getRepositoryToken(Workspace),
          useValue: { findOne: jest.fn(async () => null) },
        },
        { provide: EmailService, useValue: emailService },
        { provide: PdfGenerationProvider, useValue: pdfGenerationProvider },
        { provide: InvoiceSequenceProvider, useValue: sequenceProvider },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    provider = moduleRef.get(GenerateInvoiceProvider);
  });

  it('allocates a number from the sequence and persists it inside a transaction', async () => {
    const invoice = await provider.generateForPayment('payment-1');

    expect(invoice.invoiceNumber).toBe('INV-00001');
    expect(sequenceProvider.nextInvoiceNumber).toHaveBeenCalledTimes(1);
    expect(transactionCount).toBe(1);
    expect(table.rows).toHaveLength(1);
  });

  it('gives every concurrent generation a distinct, gap-free number', async () => {
    const invoices = await Promise.all([
      provider.generateForPayment('payment-1'),
      provider.generateForPayment('payment-2'),
      provider.generateForPayment('payment-3'),
    ]);

    const numbers = invoices.map((invoice) => invoice.invoiceNumber);
    expect(numbers).toEqual(['INV-00001', 'INV-00002', 'INV-00003']);
    expect(new Set(numbers).size).toBe(3);
  });

  it('reuses the invoice already stored for a payment', async () => {
    const first = await provider.generateForPayment('payment-1');
    const second = await provider.generateForPayment('payment-1');

    expect(second.id).toBe(first.id);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(table.rows).toHaveLength(1);
  });

  it('returns the winner when two callers invoice the same payment at once', async () => {
    // Both callers run their initial "does an invoice exist?" lookup
    // before either has inserted, which is exactly the check-then-act
    // window the paymentId unique index has to close.
    existingLookup.mockImplementation(
      async ({ where }: { where: { paymentId?: string } }) =>
        where.paymentId
          ? (table.findByPaymentId(where.paymentId) ?? null)
          : null,
    );

    const [a, b] = await Promise.all([
      provider.generateForPayment('payment-1'),
      provider.generateForPayment('payment-1'),
    ]);

    expect(a.id).toBe(b.id);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].invoiceNumber).toBe('INV-00001');
  });

  it('retries with a fresh number when the allocated one is already taken', async () => {
    const insert = jest.spyOn(table, 'insert');
    insert.mockImplementationOnce(() => {
      throw Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'IDX_invoices_invoice_number_unique',
      });
    });

    const invoice = await provider.generateForPayment('payment-1');

    expect(invoice.invoiceNumber).toBe('INV-00002');
    expect(sequenceProvider.nextInvoiceNumber).toHaveBeenCalledTimes(2);
    expect(table.rows).toHaveLength(1);
  });

  it('gives up after exhausting the collision retries', async () => {
    jest.spyOn(table, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'IDX_invoices_invoice_number_unique',
      });
    });

    await expect(provider.generateForPayment('payment-1')).rejects.toThrow(
      'duplicate key value',
    );
    // 1 initial attempt + 3 retries, each with its own sequence value.
    expect(sequenceProvider.nextInvoiceNumber).toHaveBeenCalledTimes(4);
    expect(table.rows).toHaveLength(0);
  });

  it('propagates a non-uniqueness failure without retrying', async () => {
    jest.spyOn(table, 'insert').mockImplementation(() => {
      throw new Error('value too long for type character varying(20)');
    });

    await expect(provider.generateForPayment('payment-1')).rejects.toThrow(
      'value too long for type character varying(20)',
    );
    expect(sequenceProvider.nextInvoiceNumber).toHaveBeenCalledTimes(1);
    expect(table.rows).toHaveLength(0);
  });

  it('leaves no visible invoice behind when generation fails', async () => {
    jest.spyOn(table, 'insert').mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(provider.generateForPayment('payment-1')).rejects.toThrow(
      'boom',
    );

    expect(table.rows).toEqual([]);
    expect(pdfGenerationProvider.generate).not.toHaveBeenCalled();
    expect(emailService.sendInvoiceReadyEmail).not.toHaveBeenCalled();
  });

  it('notifies the customer exactly once for the transaction that inserted', async () => {
    await provider.generateForPayment('payment-1');
    // Let the fire-and-forget PDF/email chain settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(pdfGenerationProvider.generate).toHaveBeenCalledTimes(1);
    expect(emailService.sendInvoiceReadyEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendInvoiceReadyEmail).toHaveBeenCalledWith(
      USER.email,
      USER.fullName,
      expect.objectContaining({ invoiceNumber: 'INV-00001' }),
      expect.any(Buffer),
    );
  });

  it('does not re-notify the customer when the invoice already existed', async () => {
    await provider.generateForPayment('payment-1');
    await new Promise((resolve) => setImmediate(resolve));
    jest.clearAllMocks();

    await provider.generateForPayment('payment-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(pdfGenerationProvider.generate).not.toHaveBeenCalled();
    expect(emailService.sendInvoiceReadyEmail).not.toHaveBeenCalled();
  });

  it('rejects an unknown payment before allocating a number', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GenerateInvoiceProvider,
        {
          provide: getRepositoryToken(Invoice),
          useValue: { findOne: jest.fn(async () => null) },
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: { findOne: jest.fn(async () => null) },
        },
        {
          provide: getRepositoryToken(Booking),
          useValue: { findOne: jest.fn() },
        },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(Workspace),
          useValue: { findOne: jest.fn() },
        },
        { provide: EmailService, useValue: emailService },
        { provide: PdfGenerationProvider, useValue: pdfGenerationProvider },
        { provide: InvoiceSequenceProvider, useValue: sequenceProvider },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    const isolated = moduleRef.get(GenerateInvoiceProvider);

    await expect(isolated.generateForPayment('missing')).rejects.toThrow(
      'Payment "missing" not found',
    );
    expect(sequenceProvider.nextInvoiceNumber).not.toHaveBeenCalled();
  });
});
