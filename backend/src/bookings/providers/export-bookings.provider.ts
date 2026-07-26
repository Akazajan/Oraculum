import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
import { UserRole } from '../../users/enums/userRoles.enum';

@Injectable()
export class ExportBookingsProvider {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
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

    const qb = this.bookingsRepository
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.workspace', 'workspace')
      .leftJoinAndSelect('booking.user', 'user')
      .select([
        'booking',
        'workspace.id',
        'workspace.name',
        'workspace.type',
        'user.id',
        'user.firstname',
        'user.lastname',
        'user.email',
      ]);

    if (!isAdmin) {
      qb.where('booking.userId = :userId', { userId });
    }

    if (startDate) {
      qb.andWhere('booking.startDate >= :startDate', { startDate });
    }

    if (endDate) {
      qb.andWhere('booking.endDate <= :endDate', { endDate });
    }

    qb.orderBy('booking.createdAt', 'DESC');

    const bookings = await qb.getMany();

    return bookings.map((b) => ({
      id: b.id,
      userId: b.userId,
      userName: b.user ? `${b.user.firstname} ${b.user.lastname}` : '',
      userEmail: b.user?.email ?? '',
      workspaceName: b.workspace?.name ?? '',
      workspaceType: b.workspace?.type ?? '',
      planType: b.planType,
      startDate: b.startDate,
      endDate: b.endDate,
      totalAmount: b.totalAmount,
      totalAmountNaira: b.totalAmount / 100,
      status: b.status,
      seatCount: b.seatCount,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  static readonly columns = [
    { key: 'id', header: 'ID' },
    { key: 'userId', header: 'User ID' },
    { key: 'userName', header: 'User Name' },
    { key: 'userEmail', header: 'User Email' },
    { key: 'workspaceName', header: 'Workspace' },
    { key: 'workspaceType', header: 'Workspace Type' },
    { key: 'planType', header: 'Plan Type' },
    { key: 'startDate', header: 'Start Date' },
    { key: 'endDate', header: 'End Date' },
    { key: 'totalAmount', header: 'Total Amount (Kobo)' },
    { key: 'totalAmountNaira', header: 'Total Amount (Naira)' },
    { key: 'status', header: 'Status' },
    { key: 'seatCount', header: 'Seat Count' },
    { key: 'createdAt', header: 'Created At' },
  ];
}
