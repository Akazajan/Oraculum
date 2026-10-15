import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../../bookings/entities/booking.entity';
import { BookingStatus } from '../../bookings/enums/booking-status.enum';
import { FindWorkspaceByIdProvider } from './find-workspace-by-id.provider';

export interface AvailabilityResult {
  available: boolean;
  availableSeats: number;
  totalSeats: number;
  message?: string;
}

@Injectable()
export class CheckWorkspaceAvailabilityProvider {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    private readonly findWorkspaceByIdProvider: FindWorkspaceByIdProvider,
  ) {}

  async check(
    workspaceId: string,
    requestedSeats: number = 1,
    startDate?: string,
    endDate?: string,
  ): Promise<AvailabilityResult> {
    if ((startDate === undefined) !== (endDate === undefined)) {
      throw new BadRequestException(
        'startDate and endDate must be provided together',
      );
    }

    if (startDate !== undefined && endDate !== undefined) {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new BadRequestException(
          'endDate must be a valid date after startDate',
        );
      }
    }

    const workspace =
      await this.findWorkspaceByIdProvider.findById(workspaceId);

    if (!workspace.isActive) {
      return {
        available: false,
        availableSeats: 0,
        totalSeats: workspace.totalSeats,
        message: 'Workspace is not active',
      };
    }

    let availableSeats = workspace.availableSeats;
    if (startDate !== undefined && endDate !== undefined) {
      const bookings = await this.bookingsRepository
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.seatCount), 0)', 'booked')
        .where('b.workspaceId = :workspaceId', { workspaceId })
        .andWhere('b.status IN (:...statuses)', {
          statuses: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
        })
        // Match creation's half-open [startDate, endDate) overlap rule.
        .andWhere('b.startDate < :endDate', { endDate })
        .andWhere('b.endDate > :startDate', { startDate })
        .getRawOne<{ booked: string }>();
      availableSeats = Math.max(
        0,
        workspace.totalSeats - Number(bookings?.booked ?? 0),
      );
    }

    const available = availableSeats >= requestedSeats;
    return {
      available,
      availableSeats,
      totalSeats: workspace.totalSeats,
      message: available
        ? undefined
        : `Only ${availableSeats} seats available`,
    };
  }
}
