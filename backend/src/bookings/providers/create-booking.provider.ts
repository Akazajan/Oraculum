import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { CreateBookingDto } from '../dto/create-booking.dto';
import { CreateRecurringBookingDto } from '../dto/create-recurring-booking.dto';
import { RecurrenceFrequency } from '../enums/recurrence-frequency.enum';
import { RecurringBookingConflictException } from '../exceptions/recurring-booking-conflict.exception';
import { BookingStatus } from '../enums/booking-status.enum';
import { PricingService } from '../pricing/pricing.service';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { User } from '../../users/entities/user.entity';
import { EmailService } from '../../email/email.service';
import { CacheInvalidationProvider } from '../../common/providers/cache-invalidation.provider';

@Injectable()
export class CreateBookingProvider {
  private readonly logger = new Logger(CreateBookingProvider.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly pricingService: PricingService,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly cacheInvalidation: CacheInvalidationProvider,
  ) {}

  async create(dto: CreateBookingDto, userId: string): Promise<Booking> {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const workspace = await manager
        .createQueryBuilder(Workspace, 'w')
        .setLock('pessimistic_write')
        .where('w.id = :id', { id: dto.workspaceId })
        .getOne();

      if (!workspace) {
        throw new NotFoundException(`Workspace "${dto.workspaceId}" not found`);
      }
      if (!workspace.isActive) {
        throw new BadRequestException('Workspace is not active');
      }

      const overlap = await manager
        .createQueryBuilder(Booking, 'b')
        .select('COALESCE(SUM(b.seatCount), 0)', 'booked')
        .where('b.workspaceId = :workspaceId', {
          workspaceId: dto.workspaceId,
        })
        .andWhere('b.status IN (:...statuses)', {
          statuses: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
        })
        // Bookings use half-open intervals [startDate, endDate), so touching
        // reservations do not overlap.
        .andWhere('b.startDate < :endDate', { endDate: dto.endDate })
        .andWhere('b.endDate > :startDate', { startDate: dto.startDate })
        .getRawOne<{ booked: string }>();

      const alreadyBooked = Number(overlap?.booked ?? 0);
      if (alreadyBooked + dto.seatCount > workspace.totalSeats) {
        throw new ConflictException(
          `Only ${workspace.totalSeats - alreadyBooked} seat(s) available for the requested dates`,
        );
      }

      const totalAmount = this.pricingService.calculateAmount(
        Number(workspace.hourlyRate),
        dto.planType,
        dto.seatCount,
        dto.startDate,
        dto.endDate,
      );

      const booking = manager.create(Booking, {
        ...dto,
        userId,
        totalAmount,
        status: BookingStatus.PENDING,
      });

      const savedBooking = await manager.save(booking);

      this.usersRepository
        .findOne({ where: { id: userId } })
        .then((user) => {
          if (!user) return;
          this.emailService
            .sendBookingCreatedEmail(user.email, user.fullName, {
              bookingId: savedBooking.id,
              workspaceName: workspace.name,
              planType: savedBooking.planType,
              startDate: savedBooking.startDate,
              endDate: savedBooking.endDate,
              seatCount: savedBooking.seatCount,
              totalAmountNaira: (totalAmount / 100).toFixed(2),
            })
            .catch(() => void 0);
        })
        .catch(() => void 0);

      return savedBooking;
    });

    this.cacheInvalidation
      .invalidateBookingList(dto.workspaceId)
      .catch(() => this.logger.warn('Failed to invalidate booking cache'));

    return saved;
  }

  /**
   * BE-29 — Create a recurring booking series atomically.
   *
   * Transaction boundary model: the ENTIRE series (workspace lock +
   * pre-validation of every occurrence + persistence of every occurrence)
   * executes inside ONE `dataSource.transaction` unit of work. Any throw
   * (validation failure, seat collision, DB error) aborts the callback, so
   * TypeORM rolls back the whole series — zero partial persistence.
   *
   * Two-phase approach within the transaction:
   *  1. Expand occurrences deterministically from the first window +
   *     frequency/count, then pre-validate EVERY interval against existing
   *     PENDING/CONFIRMED reservations (plus intra-series overlaps).
   *  2. Only after all occurrences validate cleanly, persist them together.
   */
  async createRecurring(
    dto: CreateRecurringBookingDto,
    userId: string,
  ): Promise<Booking[]> {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('endDate must be after startDate');
    }
    if (!Number.isInteger(dto.occurrenceCount) || dto.occurrenceCount < 1) {
      throw new BadRequestException('occurrenceCount must be a positive integer');
    }

    const occurrences = expandRecurringOccurrences(
      dto.startDate,
      dto.endDate,
      dto.recurrenceFrequency,
      dto.occurrenceCount,
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const workspace = await manager
        .createQueryBuilder(Workspace, 'w')
        .setLock('pessimistic_write')
        .where('w.id = :id', { id: dto.workspaceId })
        .getOne();

      if (!workspace) {
        throw new NotFoundException(`Workspace "${dto.workspaceId}" not found`);
      }
      if (!workspace.isActive) {
        throw new BadRequestException('Workspace is not active');
      }

      // Phase 1: pre-validate ALL occurrences before persisting any.
      for (let i = 0; i < occurrences.length; i++) {
        const occ = occurrences[i];
        const overlap = await manager
          .createQueryBuilder(Booking, 'b')
          .select('COALESCE(SUM(b.seatCount), 0)', 'booked')
          .where('b.workspaceId = :workspaceId', {
            workspaceId: dto.workspaceId,
          })
          .andWhere('b.status IN (:...statuses)', {
            statuses: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
          })
          .andWhere('b.startDate <= :endDate', { endDate: occ.endDate })
          .andWhere('b.endDate >= :startDate', { startDate: occ.startDate })
          .getRawOne<{ booked: string }>();

        const alreadyBooked = Number(overlap?.booked ?? 0);
        const intraSeriesBooked = sumIntraSeriesOverlap(
          occurrences,
          i,
          dto.seatCount,
        );
        const available = workspace.totalSeats - alreadyBooked - intraSeriesBooked;

        if (alreadyBooked + intraSeriesBooked + dto.seatCount > workspace.totalSeats) {
          throw new RecurringBookingConflictException({
            occurrenceIndex: i,
            startDate: occ.startDate,
            endDate: occ.endDate,
            requestedSeats: dto.seatCount,
            availableSeats: Math.max(0, available),
            reason: `Only ${Math.max(0, available)} seat(s) available for the requested dates`,
          });
        }
      }

      // Phase 2: every occurrence validated — persist together.
      const entities = occurrences.map((occ) =>
        manager.create(Booking, {
          workspaceId: dto.workspaceId,
          planType: dto.planType,
          seatCount: dto.seatCount,
          notes: dto.notes,
          startDate: occ.startDate,
          endDate: occ.endDate,
          userId,
          totalAmount: this.pricingService.calculateAmount(
            Number(workspace.hourlyRate),
            dto.planType,
            dto.seatCount,
            occ.startDate,
            occ.endDate,
          ),
          status: BookingStatus.PENDING,
        }),
      );

      return manager.save(entities);
    });

    this.cacheInvalidation
      .invalidateBookingList(dto.workspaceId)
      .catch(() => this.logger.warn('Failed to invalidate booking cache'));

    return saved;
  }
}

/**
 * Expand the first occurrence window into `count` intervals.
 * Exported for unit testing. Uses UTC arithmetic so DST never shifts dates.
 */
export function expandRecurringOccurrences(
  startDate: string,
  endDate: string,
  frequency: RecurrenceFrequency,
  count: number,
): Array<{ startDate: string; endDate: string }> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const out: Array<{ startDate: string; endDate: string }> = [];

  for (let i = 0; i < count; i++) {
    out.push({
      startDate: shiftDate(start, frequency, i).toISOString().slice(0, 10),
      endDate: shiftDate(end, frequency, i).toISOString().slice(0, 10),
    });
  }
  return out;
}

function shiftDate(base: Date, frequency: RecurrenceFrequency, steps: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  if (frequency === RecurrenceFrequency.DAILY) {
    d.setUTCDate(d.getUTCDate() + steps);
  } else if (frequency === RecurrenceFrequency.WEEKLY) {
    d.setUTCDate(d.getUTCDate() + steps * 7);
  } else {
    d.setUTCMonth(d.getUTCMonth() + steps);
  }
  return d;
}

/** Seats consumed by earlier occurrences in the same series overlapping occurrence `index`. */
function sumIntraSeriesOverlap(
  occurrences: Array<{ startDate: string; endDate: string }>,
  index: number,
  seatCount: number,
): number {
  const current = occurrences[index];
  let sum = 0;
  for (let j = 0; j < index; j++) {
    const prev = occurrences[j];
    if (prev.startDate <= current.endDate && prev.endDate >= current.startDate) {
      sum += seatCount;
    }
  }
  return sum;
}
