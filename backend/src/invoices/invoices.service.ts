import { BadRequestException, Injectable } from '@nestjs/common';
import { GenerateInvoiceProvider } from './providers/generate-invoice.provider';
import { FindInvoicesProvider } from './providers/find-invoices.provider';
import { PdfInvoiceProvider } from './providers/pdf-invoice.provider';
import { ExportInvoicesProvider } from './providers/export-invoices.provider';
import { PdfGenerationProvider } from './providers/pdf-generation.provider';
import { InvoiceQueryDto } from './dto/invoice-query.dto';
import { InvoiceStatusTransitionProvider } from './providers/invoice-status-transition.provider';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { UserRole } from '../users/enums/userRoles.enum';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly generateInvoiceProvider: GenerateInvoiceProvider,
    private readonly findInvoicesProvider: FindInvoicesProvider,
    private readonly pdfInvoiceProvider: PdfInvoiceProvider,
    private readonly exportInvoicesProvider: ExportInvoicesProvider,
    private readonly pdfGenerationProvider: PdfGenerationProvider,
    private readonly statusTransitionProvider: InvoiceStatusTransitionProvider,
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
  ) {}

  generateForPayment(paymentId: string) {
    return this.generateInvoiceProvider.generateForPayment(paymentId);
  }

  findAll(query: InvoiceQueryDto, userId: string, userRole: UserRole) {
    return this.findInvoicesProvider.findAll(query, userId, userRole);
  }

  findById(invoiceId: string, userId: string, userRole: UserRole) {
    return this.findInvoicesProvider.findById(invoiceId, userId, userRole);
  }

  async downloadPdf(
    invoiceId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<{ pdf: Buffer; invoiceNumber: string }> {
    const invoice = await this.findInvoicesProvider.findById(
      invoiceId,
      userId,
      userRole,
    );
    const pdf = await this.pdfGenerationProvider.generate(invoice);
    return { pdf, invoiceNumber: invoice.invoiceNumber };
  }

  exportCsv(userId: string, userRole: UserRole, startDate?: string, endDate?: string) {
    return this.exportInvoicesProvider.findAllForExport(userId, userRole, startDate, endDate);
  }

  /**
   * B48 — Transition an invoice between lifecycle statuses. Skipping a
   * required lifecycle state (e.g. PENDING -> VOID directly is allowed,
   * but PAID -> PENDING is not) raises a BadRequestException. Re-applying
   * the same terminal transition is idempotent.
   */
  async transitionStatus(invoiceId: string, to: InvoiceStatus): Promise<Invoice> {
    const invoice = await this.invoicesRepository.findOne({ where: { id: invoiceId } });
    if (!invoice) {
      throw new BadRequestException(`Invoice "${invoiceId}" not found`);
    }

    this.statusTransitionProvider.validateTransition(invoice.status, to);

    invoice.status = to;
    return this.invoicesRepository.save(invoice);
  }

  validateTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    this.statusTransitionProvider.validateTransition(from, to);
  }
}
}
