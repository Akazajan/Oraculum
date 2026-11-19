import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';

import {
  INVOICE_NUMBER_SEQUENCE,
  InvoiceSequenceProvider,
  formatInvoiceNumber,
  isInvoiceNumberCollision,
} from './invoice-sequence.provider';

/** Shape of the error `pg` raises for a unique index violation. */
function uniqueViolation(constraint: string, message?: string) {
  return Object.assign(new Error(message ?? 'duplicate key value'), {
    code: '23505',
    constraint,
  });
}

describe('formatInvoiceNumber', () => {
  it('zero-pads the sequence value to five digits', () => {
    expect(formatInvoiceNumber(1)).toBe('INV-00001');
    expect(formatInvoiceNumber(42)).toBe('INV-00042');
    expect(formatInvoiceNumber(99999)).toBe('INV-99999');
  });

  it('does not truncate values that exceed the padding width', () => {
    expect(formatInvoiceNumber(100000)).toBe('INV-100000');
  });

  it('accepts the string values `nextval()` returns over the wire', () => {
    expect(formatInvoiceNumber('7')).toBe('INV-00007');
  });

  it('refuses values that cannot be rendered as an invoice number', () => {
    expect(() => formatInvoiceNumber(null)).toThrow(/non-usable value/);
    expect(() => formatInvoiceNumber(undefined)).toThrow(/non-usable value/);
    expect(() => formatInvoiceNumber(Number.NaN)).toThrow(/non-usable value/);
    expect(() => formatInvoiceNumber(-1)).toThrow(/non-usable value/);
    expect(() => formatInvoiceNumber(1.5)).toThrow(/non-usable value/);
  });
});

describe('isInvoiceNumberCollision', () => {
  it('detects a unique violation from the SQLSTATE', () => {
    expect(isInvoiceNumberCollision(uniqueViolation('PK_invoices'))).toBe(true);
  });

  it('detects a violation reported only through the driver message', () => {
    expect(
      isInvoiceNumberCollision(new Error('duplicate key value violates')),
    ).toBe(true);
    expect(isInvoiceNumberCollision({ message: 'Duplicate Key Value' })).toBe(
      true,
    );
  });

  it('ignores unrelated database errors', () => {
    expect(isInvoiceNumberCollision(new Error('connection terminated'))).toBe(
      false,
    );
    expect(
      isInvoiceNumberCollision(
        Object.assign(new Error('nope'), { code: '23503' }),
      ),
    ).toBe(false);
  });

  it('ignores non-object throwables', () => {
    expect(isInvoiceNumberCollision('duplicate key')).toBe(false);
    expect(isInvoiceNumberCollision(null)).toBe(false);
    expect(isInvoiceNumberCollision(undefined)).toBe(false);
  });

  it('only matches the named constraint when one is supplied', () => {
    expect(
      isInvoiceNumberCollision(
        uniqueViolation('IDX_invoices_payment_id_unique'),
        'PK_other',
      ),
    ).toBe(false);
    expect(
      isInvoiceNumberCollision(uniqueViolation('PK_other'), 'PK_other'),
    ).toBe(true);
  });
});

describe('InvoiceSequenceProvider', () => {
  let provider: InvoiceSequenceProvider;
  let query: jest.Mock;
  let nextval: number;

  beforeEach(() => {
    jest.clearAllMocks();
    nextval = 1;
    query = jest.fn(async (sql: string) => {
      if (sql.includes('nextval')) {
        return [{ nextval: String(nextval++) }];
      }
      return [];
    });

    provider = new InvoiceSequenceProvider({ query } as unknown as DataSource);
  });

  it('creates the sequence and advances it past the highest existing invoice', async () => {
    await provider.onApplicationBootstrap();

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain(
      `CREATE SEQUENCE IF NOT EXISTS ${INVOICE_NUMBER_SEQUENCE}`,
    );
    // The alignment statement is what stops a restored database from
    // re-issuing numbers that already exist.
    expect(query.mock.calls[1][0]).toContain('setval');
    expect(query.mock.calls[1][0]).toContain('GREATEST');
    expect(query.mock.calls[1][0]).toContain('invoices');
  });

  it('allocates a number from the sequence', async () => {
    const invoiceNumber = await provider.nextInvoiceNumber();

    expect(invoiceNumber).toBe('INV-00001');
    expect(query).toHaveBeenCalledWith(
      `SELECT nextval('${INVOICE_NUMBER_SEQUENCE}')`,
    );
  });

  it('hands out a distinct number to every concurrent caller', async () => {
    // No bootstrap, so the first call has to ensure the sequence itself.
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () => provider.nextInvoiceNumber()),
    );

    expect(new Set(numbers).size).toBe(25);
  });

  it('ensures the sequence lazily when bootstrap has not run', async () => {
    await provider.nextInvoiceNumber();

    const sql = query.mock.calls.map((call) => String(call[0]));
    expect(sql.some((s) => s.includes('CREATE SEQUENCE'))).toBe(true);
    expect(sql.filter((s) => s.includes('CREATE SEQUENCE'))).toHaveLength(1);
  });

  it('does not re-create the sequence on every allocation', async () => {
    await provider.nextInvoiceNumber();
    await provider.nextInvoiceNumber();
    await provider.nextInvoiceNumber();

    const createCalls = query.mock.calls.filter((call) =>
      String(call[0]).includes('CREATE SEQUENCE'),
    );
    expect(createCalls).toHaveLength(1);
  });

  it('surfaces a broken sequence instead of returning a bogus number', async () => {
    query.mockRejectedValue(new Error('relation does not exist'));

    await expect(provider.nextInvoiceNumber()).rejects.toThrow(
      'relation does not exist',
    );
  });

  it('does not stop the app from booting when the sequence cannot be created', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    query.mockRejectedValue(new Error('permission denied'));

    await expect(provider.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('permission denied'),
    );

    logger.mockRestore();
  });
});
