import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { CreateBookingProvider } from './providers/create-booking.provider';
import { ConfirmBookingProvider } from './providers/confirm-booking.provider';
import { CancelBookingProvider } from './providers/cancel-booking.provider';
import { CompleteBookingProvider } from './providers/complete-booking.provider';
import { FindBookingsProvider } from './providers/find-bookings.provider';
import { PricingService } from './pricing/pricing.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { User } from '../users/entities/user.entity';
import { CacheInvalidationProvider } from '../common/providers/cache-invalidation.provider';
import { ExportBookingsProvider } from './providers/export-bookings.provider';
import { CsvExportService } from '../common/csv-export/csv-export.service';
import { BookingReminderScheduler } from './providers/booking-reminder.provider';
import { RecurringBookingService } from '../modules/bookings/recurring-booking';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, User]), WorkspacesModule],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    PricingService,
    CreateBookingProvider,
    ConfirmBookingProvider,
    CancelBookingProvider,
    CompleteBookingProvider,
    FindBookingsProvider,
    CacheInvalidationProvider,
    ExportBookingsProvider,
    CsvExportService,
    BookingReminderScheduler,
    RecurringBookingService,
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
