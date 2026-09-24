import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '../enums/booking-status.enum';

/**
 * Expires stale pending reservations on a schedule.
 *
 * B32 (#430) — the batch captures a single time boundary before scanning,
 * so every reservation is evaluated against the exact same instant.
 * Only PENDING bookings older than the boundary are touched, which also
 * makes the sweep safe to retry: already-processed rows are no longer
 * PENDING, so a re-run can never expire them twice.
 */
@Injectable()
export class ReservationExpiryHandler {
  private readonly logger = new Logger(ReservationExpiryHandler.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async expireStaleReservations(): Promise<void> {
    const boundary = new Date(Date.now() - 30 * 60 * 1000);
    const staleReservations = await this.bookingsRepository.find({
      where: { status: BookingStatus.PENDING, createdAt: LessThan(boundary) },
    });
    if (staleReservations.length === 0) return;

    staleReservations.forEach((booking) => {
      booking.status = BookingStatus.CANCELLED;
    });
    await this.bookingsRepository.save(staleReservations);

    this.logger.log(`Expired ${staleReservations.length} stale reservation(s)`);
  }
}