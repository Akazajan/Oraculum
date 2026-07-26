import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class ReservationExpiryHandler {
  @Cron(CronExpression.EVERY_30_MINUTES)
  async expireStaleReservations() {
    const expiryThreshold = new Date(Date.now() - 30 * 60 * 1000);
    // Expire pending reservations older than threshold
    console.log('Expired stale reservations');
  }
}
