import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Name of the PostgreSQL sequence backing `Invoice.invoiceNumber`. */
export const INVOICE_NUMBER_SEQUENCE = 'invoice_number_seq';

/** Prefix used to render a sequence value as a human-readable number. */
export const INVOICE_NUMBER_PREFIX = 'INV-';

/** Number of digits the rendered invoice number is zero-padded to. */
export const INVOICE_NUMBER_PAD = 5;

/** PostgreSQL SQLSTATE for `unique_violation`. */
export const UNIQUE_VIOLATION = '23505';

/**
 * BE-51 — Render a raw sequence value as an invoice number.
 * Exported so the formatting contract is unit-testable in isolation.
 */
export function formatInvoiceNumber(sequenceValue: unknown): string {
  if (
    sequenceValue === null ||
    sequenceValue === undefined ||
    sequenceValue === ''
  ) {
    throw new Error(
      `invoice_number_seq returned a non-usable value: ${String(sequenceValue)}`,
    );
  }

  const value = Number(sequenceValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `invoice_number_seq returned a non-usable value: ${String(sequenceValue)}`,
    );
  }
  return `${INVOICE_NUMBER_PREFIX}${String(value).padStart(
    INVOICE_NUMBER_PAD,
    '0',
  )}`;
}

/**
 * BE-51 — Does this error mean "the invoice number I just generated is
 * already taken"? Matching on the SQLSTATE (and, when present, the
 * constraint name) is far more reliable than substring-matching the
 * driver message, which differs between `pg` versions and is not
 * guaranteed to be an `Error` instance at all.
 */
export function isInvoiceNumberCollision(
  error: unknown,
  constraint?: string,
): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  };

  if (constraint && err.constraint && err.constraint !== constraint) {
    return false;
  }
  if (err.code === UNIQUE_VIOLATION) return true;

  // Some drivers surface the violation only as a message.
  return (
    typeof err.message === 'string' &&
    err.message.toLowerCase().includes('duplicate key')
  );
}

/**
 * BE-51 — Owns the PostgreSQL sequence that backs
 * `Invoice.invoiceNumber` and hands out invoice numbers.
 *
 * `nextval()` is the only allocation primitive: it is atomic and
 * non-transactional, so two concurrent transactions can never receive
 * the same value and a rolled-back insert only burns a number (it never
 * leaves a half-written invoice behind). Uniqueness is still enforced by
 * the unique index on `invoices."invoiceNumber"`, which is what makes a
 * duplicate *visible* rather than silently corrupting the ledger.
 */
@Injectable()
export class InvoiceSequenceProvider implements OnApplicationBootstrap {
  private readonly logger = new Logger(InvoiceSequenceProvider.name);
  private ensured = false;

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureSequence();
  }

  /**
   * Create the sequence if it is missing and push it past any invoice
   * number that already exists. A database restored from a dump — or one
   * where the sequence was created after rows had been written — would
   * otherwise start handing out numbers that are already taken.
   *
   * `setval` only ever moves the sequence forward and is a single
   * statement, so concurrent boots converge on the same value.
   */
  async ensureSequence(): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE SEQUENCE IF NOT EXISTS ${INVOICE_NUMBER_SEQUENCE} START 1`,
      );
      await this.dataSource.query(
        `SELECT setval(
           '${INVOICE_NUMBER_SEQUENCE}',
           GREATEST(
             (SELECT last_value FROM ${INVOICE_NUMBER_SEQUENCE}),
             (SELECT COALESCE(MAX(NULLIF(substring("invoiceNumber" from '[0-9]+$'), '')::bigint), 0) FROM invoices)
           ),
           true
         )`,
      );
      this.ensured = true;
      this.logger.log(`${INVOICE_NUMBER_SEQUENCE} sequence ensured`);
    } catch (err) {
      // Bootstrap is best-effort — a read-only replica or a database
      // without DDL rights must not stop the app from booting.
      this.logger.error(
        `Failed to ensure ${INVOICE_NUMBER_SEQUENCE}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Allocate the next invoice number. Each call consumes exactly one
   * sequence value, so the result is never reused by another caller.
   */
  async nextInvoiceNumber(): Promise<string> {
    if (!this.ensured) {
      await this.ensureSequence();
    }

    const result = await this.dataSource.query<{ nextval: string }[]>(
      `SELECT nextval('${INVOICE_NUMBER_SEQUENCE}')`,
    );
    const row = Array.isArray(result) ? result[0] : result;
    return formatInvoiceNumber(row?.nextval);
  }
}
