import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { UserRole } from '../../users/enums/userRoles.enum';

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

    if (startDate) {
      qb.andWhere('invoice.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      qb.andWhere('invoice.createdAt <= :endDate', {
        endDate: `${endDate} 23:59:59`,
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
