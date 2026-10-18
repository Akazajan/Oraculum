import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as moment from 'moment-timezone';
import { Repository } from 'typeorm';
import { EmailService } from '../../email/email.service';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '../enums/booking-status.enum';

// B38 — Reminder window is configurable. Default: remind between 24 and
// 25 hours before the booking start. Already-sent bookings and bookings
// whose start has passed are never re-reminded.
const DEFAULT_WINDOW_START_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_SLOT_MS = 60 * 60 * 1000; // 1h

function configuredWindowStartMs(): number {
  const raw = process.env.BOOKING_REMINDER_WINDOW_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_WINDOW_START_MS;
}

function configuredSlotMs(): number {
  const raw = process.env.BOOKING_REMINDER_SLOT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOT_MS;
}

@Injectable()
export class BookingReminderScheduler {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendReminderEmails(now = new Date()): Promise<number> {
    const bookings = await this.bookingsRepository.find({
      where: [
        { status: BookingStatus.PENDING, reminderSent: false },
        { status: BookingStatus.CONFIRMED, reminderSent: false },
      ],
      relations: ['user', 'workspace'],
    });
    const nowMs = now.getTime();
    const windowStart = configuredWindowStartMs();
    const slot = configuredSlotMs();
    const reminderStart = nowMs + windowStart;
    const reminderEnd = reminderStart + slot;
    let sentCount = 0;

    for (const booking of bookings) {
      if (booking.status === BookingStatus.CANCELLED || booking.reminderSent) {
        continue;
      }

      const workspace = booking.workspace as typeof booking.workspace & {
        timezone?: string;
      };
      const timezone =
        workspace?.timezone || process.env.BOOKING_TIMEZONE || 'UTC';
      const start = moment
        .tz(booking.startDate, 'YYYY-MM-DD', timezone)
        .valueOf();

      // B38 — Past bookings receive no new reminder, and bookings outside
      // the configured future window (too soon or too far ahead) are skipped.
      if (start <= nowMs) {
        continue;
      }
      if (start < reminderStart || start >= reminderEnd || !booking.user) {
        continue;
      }

      const sent = await this.emailService.sendBookingReminderEmail(
        booking.user.email,
        booking.user.fullName,
        {
          bookingId: booking.id,
          workspaceName: booking.workspace?.name ?? 'your workspace',
          planType: booking.planType,
          startDate: booking.startDate,
          endDate: booking.endDate,
          seatCount: booking.seatCount,
          totalAmountNaira: (Number(booking.totalAmount) / 100).toFixed(2),
        },
      );

      if (sent) {
        booking.reminderSent = true;
        await this.bookingsRepository.save(booking);
        sentCount += 1;
      }
    }

    return sentCount;
  }
}
