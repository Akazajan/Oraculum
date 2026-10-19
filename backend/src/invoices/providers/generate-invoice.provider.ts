import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { Payment } from '../../payments/entities/payment.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { User } from '../../users/entities/user.entity';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { InvoiceStatus } from '../enums/invoice-status.enum';
import { EmailService } from '../../email/email.service';
import { PdfGenerationProvider } from './pdf-generation.provider';
import {
  InvoiceSequenceProvider,
  isInvoiceNumberCollision,
} from './invoice-sequence.provider';

@Injectable()
export class GenerateInvoiceProvider {
  private readonly logger = new Logger(GenerateInvoiceProvider.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly pdfGenerationProvider: PdfGenerationProvider,
    private readonly invoiceSequenceProvider: InvoiceSequenceProvider,
  ) {}

  async generateForPayment(paymentId: string): Promise<Invoice> {
    const existing = await this.invoicesRepository.findOne({
      where: { paymentId },
    });
    if (existing) {
      return existing;
    }

    const payment = await this.paymentsRepository.findOne({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new Error(`Payment "${paymentId}" not found`);
    }

    const [booking, user] = await Promise.all([
      this.bookingsRepository.findOne({ where: { id: payment.bookingId } }),
      this.usersRepository.findOne({ where: { id: payment.userId } }),
    ]);

    const workspace = booking
      ? await this.workspacesRepository.findOne({
          where: { id: booking.workspaceId },
        })
      : null;

    const lineItems = [
      {
        description: workspace
          ? `${workspace.name} — ${booking.planType} booking`
          : `Booking ${booking?.id ?? ''}`,
        startDate: booking?.startDate,
        endDate: booking?.endDate,
        seatCount: booking?.seatCount ?? 1,
        amountKobo: payment.amount,
        amountNaira: payment.amount / 100,
      },
    ];

    const { invoice: saved, created } =
      await this.createWithUniqueInvoiceNumber({
        userId: payment.userId,
        bookingId: payment.bookingId,
        paymentId: payment.id,
        amountKobo: payment.amount,
        currency: payment.currency,
        status: InvoiceStatus.PAID,
        paidAt: payment.paidAt,
        lineItems,
      });
    this.logger.log(
      created
        ? `Invoice ${saved.invoiceNumber} generated for payment ${paymentId}`
        : `Invoice ${saved.invoiceNumber} already exists for payment ${paymentId} — returning it`,
    );

    // Only the transaction that actually inserted the row notifies the
    // customer. A caller that lost the race must not send a second
    // "invoice ready" email for the same invoice.
    if (created && user) {
      this.pdfGenerationProvider
        .generate(saved)
        .then((pdfBuffer) => {
          this.emailService
            .sendInvoiceReadyEmail(
              user.email,
              user.fullName,
              {
                invoiceNumber: saved.invoiceNumber,
                amountNaira: (saved.amountKobo / 100).toFixed(2),
                paidAt: saved.paidAt
                  ? new Date(saved.paidAt).toLocaleString()
                  : '',
              },
              pdfBuffer,
            )
            .catch(() => void 0);
        })
        .catch(() => void 0);
    }

    return saved;
  }

  /**
   * BE-51 — Generates an invoice using a number allocated from the
   * PostgreSQL sequence while guaranteeing uniqueness under concurrent
   * creation.
   *
   * Two independent races are handled:
   *
   * 1. Two callers generating invoices *at the same time*. The number
   *    comes from `nextval()`, which is atomic, and the insert runs in
   *    its own transaction so a failure rolls the row back entirely —
   *    a failed generation never leaves a half-written (or visible)
   *    invoice behind. If the unique index on `invoiceNumber` still
   *    rejects the insert (a database restored from a dump, where the
   *    sequence can lag behind the rows), the caller retries with a
   *    freshly allocated number.
   *
   * 2. Two callers generating an invoice *for the same payment*. The
   *    "does one already exist?" lookup at the top of
   *    `generateForPayment` is a check-then-act and cannot close that
   *    window on its own, so the partial unique index on `paymentId`
   *    is the real guard: the loser of the race catches the violation
   *    and returns the invoice the winner created instead of inserting
   *    a second one.
   */
  private async createWithUniqueInvoiceNumber(
    data: Partial<Invoice>,
  ): Promise<{ invoice: Invoice; created: boolean }> {
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const invoiceNumber =
        await this.invoiceSequenceProvider.nextInvoiceNumber();

      try {
        const invoice = await this.dataSource.transaction(async (manager) => {
          const draft = manager.create(Invoice, {
            ...data,
            invoiceNumber,
          });
          return manager.save(draft);
        });
        return { invoice, created: true };
      } catch (err) {
        // The insert lost the race against a concurrent generation for
        // the same payment. Surface the winner's invoice rather than
        // burning the whole call.
        if (data.paymentId && isInvoiceNumberCollision(err)) {
          const concurrent = await this.invoicesRepository.findOne({
            where: { paymentId: data.paymentId },
          });
          if (concurrent) {
            this.logger.warn(
              `Invoice ${invoiceNumber} discarded — payment ${data.paymentId} was already invoiced as ${concurrent.invoiceNumber}`,
            );
            return { invoice: concurrent, created: false };
          }
        }

        if (!isInvoiceNumberCollision(err) || attempt === MAX_RETRIES) {
          throw err;
        }
        this.logger.warn(
          `Invoice number ${invoiceNumber} collided under concurrency — retrying with fresh number`,
        );
      }
    }

    throw new Error('Failed to allocate a unique invoice number');
  }
}
