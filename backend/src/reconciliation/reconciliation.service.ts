import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentStatus } from '../payments/enums/payment-status.enum';
import { AuditService, AuditAction } from '../audit/audit.service';
import {
  ReconciliationReport,
  ReconciliationOutcome,
} from './entities/reconciliation-report.entity';

/**
 * BE-30 — Reconciliation cron service.
 *
 * Periodically compares Invoice status with Payment status and
 * fixes mismatches (e.g., invoice marked PENDING but payment is SUCCESS).
 *
 * The reconciliation interval is configurable via the
 * RECONCILIATION_CRON environment variable (defaults to every 30 minutes).
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepo: Repository<Invoice>,
    @InjectRepository(Payment)
    private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(ReconciliationReport)
    private readonly reportsRepo: Repository<ReconciliationReport>,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('0 */30 * * * *')
  async reconcile() {
    this.logger.log('Starting reconciliation run');

    const invoiceStatuses = await this.invoicesRepo.find({
      where: [
        { status: InvoiceStatus.PENDING },
        { status: InvoiceStatus.PAID },
      ],
      relations: ['payment'],
    });

    let fixed = 0;
    let matched = 0;
    let failed = 0;

    for (const invoice of invoiceStatuses) {
      if (!invoice.paymentId) continue;

      const payment = await this.paymentsRepo.findOne({
        where: { id: invoice.paymentId },
      });

      if (!payment) {
        failed++;
        await this.recordReport(invoice, null, ReconciliationOutcome.FAILED, 'Payment record not found');
        continue;
      }

      const result = this.reconcilePair(invoice, payment);
      switch (result) {
        case 'fixed':
          fixed++;
          break;
        case 'matched':
          matched++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    this.logger.log(
      `Reconciliation complete: ${matched} matched, ${fixed} fixed, ${failed} failed out of ${invoiceStatuses.length} invoices`,
    );

    this.auditService.log({
      action: AuditAction.PAYMENT_RECONCILED,
      outcome: 'SUCCESS',
      resourceType: 'ReconciliationRun',
      metadata: { matched, fixed, failed, total: invoiceStatuses.length },
    });

    return { matched, fixed, failed, total: invoiceStatuses.length };
  }

  private reconcilePair(
    invoice: Invoice,
    payment: Payment,
  ): 'matched' | 'fixed' | 'failed' {
    // Case 1: Payment succeeded but invoice still PENDING
    if (
      payment.status === PaymentStatus.SUCCESS &&
      invoice.status === InvoiceStatus.PENDING
    ) {
      invoice.status = InvoiceStatus.PAID;
      invoice.paidAt = payment.paidAt ?? new Date();
      this.invoicesRepo.save(invoice);
      this.recordReport(
        invoice,
        payment,
        ReconciliationOutcome.FIXED,
        `Invoice status updated from PENDING to PAID to match payment SUCCESS`,
      );
      this.logger.warn(
        `Reconciled invoice ${invoice.invoiceNumber}: PENDING -> PAID (payment ${payment.id} is SUCCESS)`,
      );
      return 'fixed';
    }

    // Case 2: Payment failed but invoice is PAID
    if (
      payment.status === PaymentStatus.FAILED &&
      invoice.status === InvoiceStatus.PAID
    ) {
      invoice.status = InvoiceStatus.VOID;
      this.invoicesRepo.save(invoice);
      this.recordReport(
        invoice,
        payment,
        ReconciliationOutcome.FIXED,
        `Invoice status updated from PAID to VOID to match payment FAILED`,
      );
      this.logger.warn(
        `Reconciled invoice ${invoice.invoiceNumber}: PAID -> VOID (payment ${payment.id} is FAILED)`,
      );
      return 'fixed';
    }

    // Case 3: Both match or no action needed
    this.recordReport(
      invoice,
      payment,
      ReconciliationOutcome.MATCHED,
      `Invoice ${invoice.status} / Payment ${payment.status} — consistent`,
    );
    return 'matched';
  }

  private async recordReport(
    invoice: Invoice,
    payment: Payment | null,
    outcome: ReconciliationOutcome,
    message: string,
  ): Promise<void> {
    try {
      const report = this.reportsRepo.create({
        invoiceId: invoice.id,
        paymentId: payment?.id ?? null,
        invoiceStatus: invoice.status,
        paymentStatus: payment?.status ?? 'unknown',
        outcome,
        message,
      });
      await this.reportsRepo.save(report);
    } catch (err) {
      this.logger.warn(
        `Failed to save reconciliation report: ${(err as Error).message}`,
      );
    }
  }
}
