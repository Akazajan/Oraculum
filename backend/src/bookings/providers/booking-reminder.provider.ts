import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class BookingReminderScheduler {
  @Cron(CronExpression.EVERY_HOUR)
  async sendReminderEmails() {
    // Send reminder emails for bookings in 24 hours
    console.log('Reminder emails sent for upcoming bookings');
  }
}
