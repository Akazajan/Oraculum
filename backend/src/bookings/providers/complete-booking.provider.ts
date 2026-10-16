import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '../enums/booking-status.enum';
import { CacheInvalidationProvider } from '../../common/providers/cache-invalidation.provider';

/**
 * Marks a booking as COMPLETED. Only the Booking row is mutated so a
 * single save is sufficient and no transaction wrapper is required
 * (BE-12). Kept explicit for documentation and future-proofing.
 *
 * BE-24 — invalidates booking list cache after completion.
 */
@Injectable()
export class CompleteBookingProvider {
  private readonly logger = new Logger(CompleteBookingProvider.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    private readonly cacheInvalidation: CacheInvalidationProvider,
  ) {}

  async complete(bookingId: string): Promise<Booking> {
    const booking = await this.bookingsRepository.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new NotFoundException(`Booking "${bookingId}" not found`);
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only CONFIRMED bookings can be completed');
    }
    // B31 (#429) — completion is only allowed once the end date has passed,
    // so PENDING/CANCELLED and early completion attempts all fail here.
    const endOfBooking = new Date(`${booking.endDate}T23:59:59`);
    if (endOfBooking.getTime() > Date.now()) {
      throw new BadRequestException(
        'Booking cannot be completed before its end date',
      );
    }

    booking.status = BookingStatus.COMPLETED;
    const saved = await this.bookingsRepository.save(booking);

    this.cacheInvalidation
      .invalidateBookingList(saved.workspaceId)
      .catch(() => this.logger.warn('Failed to invalidate booking cache'));

    return saved;
  }
}
