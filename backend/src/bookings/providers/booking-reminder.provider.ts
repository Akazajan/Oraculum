import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import * as moment from 'moment-timezone';
import { Repository } from 'typeorm';
import { EmailService } from '../../email/email.service';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '../enums/booking-status.enum';

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
    const reminderStart = now.getTime() + 24 * 60 * 60 * 1000;
    const reminderEnd = reminderStart + 60 * 60 * 1000;
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
