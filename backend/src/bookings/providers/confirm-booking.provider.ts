import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '../enums/booking-status.enum';
import { User } from '../../users/entities/user.entity';
import { MembershipStatus } from '../../users/enums/membership-status.enum';
import { runInTransaction } from '../../common/utils/run-in-transaction';

/**
 * Confirms a booking and — atomically — promotes the user to ACTIVE on
 * their first confirmed booking (BE-12 acceptance).
 *
 * If any step fails the whole flow is rolled back. The optional
 * `manager` parameter lets callers (e.g. the Paystack webhook) reuse
 * their outer transaction so we never end up with nested savepoints.
 */
@Injectable()
export class ConfirmBookingProvider {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async confirm(
    bookingId: string,
    passedManager?: EntityManager,
  ): Promise<Booking> {
    const work = async (manager: EntityManager): Promise<Booking> => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
      });
      if (!booking) {
        throw new NotFoundException(`Booking "${bookingId}" not found`);
      }
      if (booking.status !== BookingStatus.PENDING) {
        throw new BadRequestException('Only PENDING bookings can be confirmed');
      }

      booking.status = BookingStatus.CONFIRMED;
      const savedBooking = await manager.save(booking);

      const user = await manager.findOne(User, {
        where: { id: booking.userId },
      });
      if (user && !user.memberSince) {
        user.memberSince = new Date();
        user.membershipStatus = MembershipStatus.ACTIVE;
        await manager.save(user);
      }

      // Return the in-memory record we already saved inside this
      // transaction. Don't re-fetch via the non-transactional repository
      // — a separate connection could miss the uncommitted row.
      return savedBooking;
    };

    if (passedManager) {
      return work(passedManager);
    }
    return runInTransaction(this.dataSource, work);
  }
}
