import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '../enums/booking-status.enum';
import { UserRole } from '../../users/enums/userRoles.enum';
import { User } from '../../users/entities/user.entity';
import { EmailService } from '../../email/email.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { runInTransaction } from '../../common/utils/run-in-transaction';

/**
 * Cancels a booking. Only a single entity is mutated today
 * (the Booking row), so we still wrap in a transaction so that
 * future extensions (refund insertion, cancellation ledger entry)
 * can be added here without partial-failure regressions (BE-12).
 */
@Injectable()
export class CancelBookingProvider {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async cancel(
    bookingId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<Booking> {
    const saved = await runInTransaction(this.dataSource, async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
      });
      if (!booking) {
        throw new NotFoundException(`Booking "${bookingId}" not found`);
      }

      const isAdmin =
        userRole === UserRole.ADMIN ||
        userRole === UserRole.SUPER_ADMIN ||
        userRole === UserRole.STAFF;

      if (!isAdmin && booking.userId !== userId) {
        throw new ForbiddenException('You can only cancel your own bookings');
      }

      if (
        booking.status !== BookingStatus.PENDING &&
        booking.status !== BookingStatus.CONFIRMED
      ) {
        throw new BadRequestException(
          'Only PENDING or CONFIRMED bookings can be cancelled',
        );
      }

      booking.status = BookingStatus.CANCELLED;
      return manager.save(booking);
    });

    // Fire-and-forget cancellation email (kept outside the transaction
    // because emails are best-effort and must never block state).
    Promise.all([
      this.usersRepository.findOne({ where: { id: saved.userId } }),
      this.workspacesService.findById(saved.workspaceId),
    ])
      .then(([user, workspace]) => {
        if (!user || !workspace) return;
        const cancelledBy =
          saved.userId === userId ? user.fullName : 'Administrator';
        this.emailService
          .sendBookingCancelledEmail(user.email, user.fullName, {
            bookingId: saved.id,
            workspaceName: workspace.name,
            startDate: saved.startDate,
            endDate: saved.endDate,
            cancelledBy,
          })
          .catch(() => void 0);
      })
      .catch(() => void 0);

    return saved;
  }
}
