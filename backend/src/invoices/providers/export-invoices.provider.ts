import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { UserRole } from '../../users/enums/userRoles.enum';
import { InvoiceStatus } from '../enums/invoice-status.enum';

export interface ExportInvoicesFilters {
  status?: InvoiceStatus;
  bookingId?: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class ExportInvoicesProvider {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepository: Repository<Invoice>,
  ) {}

  async findAllForExport(
    userId: string,
    userRole: UserRole,
    startDate?: string,
    endDate?: string,
    filters: ExportInvoicesFilters = {},
  ): Promise<Record<string, unknown>[]> {
    const isAdmin =
      userRole === UserRole.ADMIN ||
      userRole === UserRole.SUPER_ADMIN ||
      userRole === UserRole.STAFF;

    const qb = this.invoicesRepository
      .createQueryBuilder('invoice')
      .select([
        'invoice.id',
        'invoice.invoiceNumber',
        'invoice.userId',
        'invoice.bookingId',
        'invoice.amountKobo',
        'invoice.currency',
        'invoice.status',
        'invoice.paidAt',
        'invoice.createdAt',
      ]);

    if (!isAdmin) {
      qb.where('invoice.userId = :userId', { userId });
    }

    const start = this.parseDate(startDate, 'startDate', false);
    const end = this.parseDate(endDate, 'endDate', true);

    if (start && end && start > end) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    if (start) {
      qb.andWhere('invoice.createdAt >= :startDate', { startDate: start });
    }

    if (end) {
      qb.andWhere('invoice.createdAt <= :endDate', { endDate: end });
    }

    // Mirror the filters applied by the invoice list endpoint.
    if (filters.status) {
      if (!Object.values(InvoiceStatus).includes(filters.status)) {
        throw new BadRequestException(`Invalid invoice status: ${filters.status}`);
      }
      qb.andWhere('invoice.status = :status', { status: filters.status });
    }

    if (filters.bookingId) {
      qb.andWhere('invoice.bookingId = :bookingId', {
        bookingId: filters.bookingId,
      });
    }

    qb.orderBy('invoice.createdAt', 'DESC');

    const invoices = await qb.getMany();

    return invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      userId: inv.userId,
      bookingId: inv.bookingId,
      amountKobo: inv.amountKobo,
      amountNaira: inv.amountKobo / 100,
      currency: inv.currency,
      status: inv.status,
      paidAt: inv.paidAt?.toISOString() ?? '',
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  private parseDate(
    value: string | undefined,
    field: string,
    endOfDay: boolean,
  ): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid ${field}: ${value}`);
    }
    if (endOfDay && DATE_ONLY.test(value)) {
      date.setUTCHours(23, 59, 59, 999);
    }
    return date;
  }

  static readonly columns = [
    { key: 'id', header: 'ID' },
    { key: 'invoiceNumber', header: 'Invoice Number' },
    { key: 'userId', header: 'User ID' },
    { key: 'bookingId', header: 'Booking ID' },
    { key: 'amountKobo', header: 'Amount (Kobo)' },
    { key: 'amountNaira', header: 'Amount (Naira)' },
    { key: 'currency', header: 'Currency' },
    { key: 'status', header: 'Status' },
    { key: 'paidAt', header: 'Paid At' },
    { key: 'createdAt', header: 'Created At' },
  ];
}
