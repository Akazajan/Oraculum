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

    const invoiceNumber = await this.nextInvoiceNumber();

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

    const invoice = this.invoicesRepository.create({
      invoiceNumber,
      userId: payment.userId,
      bookingId: payment.bookingId,
      paymentId: payment.id,
      amountKobo: payment.amount,
      currency: payment.currency,
      status: InvoiceStatus.PAID,
      paidAt: payment.paidAt,
      lineItems,
    });

    const saved = await this.invoicesRepository.save(invoice);
    this.logger.log(
      `Invoice ${invoiceNumber} generated for payment ${paymentId}`,
    );

    if (user) {
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

  private async nextInvoiceNumber(): Promise<string> {
    const result = await this.dataSource.query<{ nextval: string }[]>(
      `SELECT nextval('invoice_number_seq')`,
    );
    const seq = parseInt(result[0].nextval, 10);
    return `INV-${String(seq).padStart(5, '0')}`;
  }
}