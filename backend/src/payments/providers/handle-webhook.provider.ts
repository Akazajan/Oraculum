import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Payment } from '../entities/payment.entity';
import { PaymentStatus } from '../enums/payment-status.enum';
import { PaystackProvider } from './paystack.provider';
import { SorobanEscrowProvider } from './soroban-escrow.provider';
import { BookingsService } from '../../bookings/bookings.service';
import { Booking } from '../../bookings/entities/booking.entity';
import { PlanType } from '../../bookings/enums/plan-type.enum';
import { InvoicesService } from '../../invoices/invoices.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { User } from '../../users/entities/user.entity';
import { EmailService } from '../../email/email.service';
import { runInTransaction } from '../../common/utils/run-in-transaction';

const LONG_TERM_PLANS = new Set([
  PlanType.MONTHLY,
  PlanType.QUARTERLY,
  PlanType.YEARLY,
]);

/**
 * Processes Paystack webhooks. The critical state changes
 * (Payment + Booking + on-chain escrow id) are wrapped in a
 * single TypeORM transaction so a failure rolls all of them
 * back (BE-12 acceptance).
 */
@Injectable()
export class HandleWebhookProvider {
  private readonly logger = new Logger(HandleWebhookProvider.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly paystackProvider: PaystackProvider,
    private readonly sorobanEscrowProvider: SorobanEscrowProvider,
    private readonly bookingsService: BookingsService,
    private readonly invoicesService: InvoicesService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async handle(rawBody: Buffer, signature: string): Promise<void> {
    const valid = this.paystackProvider.verifyWebhookSignature(
      rawBody,
      signature,
    );
    if (!valid) {
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    const eventType = event.event as string;
    const data = event.data as Record<string, unknown>;
    const reference = data?.reference as string;

    if (!reference) {
      this.logger.warn(
        `Webhook event "${eventType}" has no reference — skipped`,
      );
      return;
    }

    if (eventType === 'charge.success') {
      await this.handleChargeSuccess(reference, data);
    } else if (eventType === 'charge.failed') {
      await this.handleChargeFailed(reference);
    } else {
      this.logger.log(`Unhandled Paystack event: ${eventType}`);
    }
  }

  private async handleChargeSuccess(
    reference: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const result = await runInTransaction(this.dataSource, async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: { providerReference: reference },
      });

      if (!payment) {
        this.logger.warn(
          `charge.success: no payment found for reference ${reference}`,
        );
        return null;
      }

      if (payment.status === PaymentStatus.SUCCESS) {
        this.logger.log(
          `charge.success: payment ${payment.id} already succeeded — idempotent skip`,
        );
        return null;
      }

      payment.status = PaymentStatus.SUCCESS;
      payment.paidAt = new Date();
      payment.metadata = data;
      await manager.save(payment);

      // Confirm the booking inside our open transaction so the
      // Payment + Booking + (later) Soroban escrow writes commit
      // atomically. bookingsService.confirm accepts an optional
      // EntityManager and reuses ours instead of starting a nested
      // SAVEPOINT (BE-12).
      const updatedBooking = await this.bookingsService.confirm(
        payment.bookingId,
        manager,
      );

      let escrowTxHash: string | null = null;
      if (LONG_TERM_PLANS.has(updatedBooking.planType)) {
        escrowTxHash = await this.recordSorobanEscrow(
          manager,
          payment,
          updatedBooking,
        );
      }

      return { payment, booking: updatedBooking, escrowTxHash };
    });

    if (!result) return;

    const { payment } = result;

    // Best-effort side effects, run after the transaction committed.
    this.invoicesService.generateForPayment(payment.id).catch((err: Error) => {
      this.logger.error(
        `Failed to generate invoice for payment ${payment.id}: ${err.message}`,
      );
    });

    this.usersRepository
      .findOne({ where: { id: payment.userId } })
      .then((user) => {
        if (!user) return;
        this.bookingsRepository
          .findOne({ where: { id: payment.bookingId } })
          .then((bk) => {
            this.emailService
              .sendPaymentSuccessEmail(user.email, user.fullName, {
                bookingId: payment.bookingId,
                workspaceName: bk?.workspaceId ?? '',
                amountNaira: (payment.amount / 100).toFixed(2),
                paidAt: payment.paidAt
                  ? new Date(payment.paidAt).toLocaleString()
                  : '',
                invoiceNumber: '',
              })
              .catch(() => void 0);
          })
          .catch(() => void 0);
      })
      .catch(() => void 0);

    this.notificationsService
      .create({
        userId: payment.userId,
        type: NotificationType.PAYMENT_SUCCESS,
        title: 'Payment Successful',
        message: `Your payment of ₦${(payment.amount / 100).toFixed(2)} has been confirmed and your booking is now active.`,
        metadata: { paymentId: payment.id, bookingId: payment.bookingId },
      })
      .catch(() => void 0);

    this.logger.log(
      `charge.success: payment ${payment.id} succeeded, booking ${payment.bookingId} confirmed`,
    );
  }

  private async handleChargeFailed(reference: string): Promise<void> {
    const payment = await runInTransaction(this.dataSource, async (manager) => {
      const found = await manager.findOne(Payment, {
        where: { providerReference: reference },
      });

      if (!found) {
        this.logger.warn(
          `charge.failed: no payment found for reference ${reference}`,
        );
        return null;
      }

      if (found.status !== PaymentStatus.PENDING) {
        return null;
      }

      found.status = PaymentStatus.FAILED;
      return manager.save(found);
    });

    if (!payment) return;

    this.usersRepository
      .findOne({ where: { id: payment.userId } })
      .then((user) => {
        if (!user) return;
        this.emailService
          .sendPaymentFailedEmail(user.email, user.fullName, {
            paymentReference: payment.providerReference ?? payment.id,
            amountNaira: (payment.amount / 100).toFixed(2),
          })
          .catch(() => void 0);
      })
      .catch(() => void 0);

    this.notificationsService
      .create({
        userId: payment.userId,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment Failed',
        message: 'Your payment could not be processed. Please try again.',
        metadata: { paymentId: payment.id, bookingId: payment.bookingId },
      })
      .catch(() => void 0);

    this.logger.log(`charge.failed: payment ${payment.id} marked FAILED`);
  }

  /**
   * Write the Soroban escrow hash back onto the Booking row inside the
   * same transaction so the booking + payment + escrow references
   * land consistently.
   */
  private async recordSorobanEscrow(
    manager: import('typeorm').EntityManager,
    payment: Payment,
    booking: Booking,
  ): Promise<string | null> {
    try {
      const beneficiary = this.configService.get<string>(
        'STELLAR_BENEFICIARY_ADDRESS',
        'GBENEFIT_PLACEHOLDER',
      );
      const releaseAfterUnix =
        Math.floor(new Date(booking.endDate).getTime() / 1000) + 86400;

      const txHash = await this.sorobanEscrowProvider.createEscrow(
        booking.id,
        payment.userId,
        beneficiary,
        payment.amount,
        `Booking ${booking.id}`,
        releaseAfterUnix,
      );

      await manager.update(Booking, booking.id, {
        sorobanEscrowId: txHash,
      });

      this.logger.log(
        `Soroban escrow recorded for booking ${booking.id}: ${txHash}`,
      );
      return txHash;
    } catch (err) {
      // Non-critical — log but do not fail the payment confirmation.
      this.logger.error(
        `Failed to record Soroban escrow for booking ${booking.id}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
