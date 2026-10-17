import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { PaymentStatus } from '../enums/payment-status.enum';
import { PaystackProvider } from './paystack.provider';
import { UserRole } from '../../users/enums/userRoles.enum';

/**
 * BE-46 — Prevent duplicate refunds under concurrent requests.
 *
 * Reserves the payment in REFUNDING via a conditional UPDATE before
 * contacting the provider. Only one concurrent caller wins the race;
 * losers see ConflictException. Provider failures roll status back to
 * SUCCESS so the refund remains retryable without double-crediting.
 */
@Injectable()
export class RefundPaymentProvider {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly paystackProvider: PaystackProvider,
  ) {}

  async refund(
    paymentId: string,
    requestingUserId: string,
    requestingUserRole: UserRole,
  ): Promise<Payment> {
    const payment = await this.paymentsRepository.findOne({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException(`Payment "${paymentId}" not found`);
    }

    const isAdmin =
      requestingUserRole === UserRole.ADMIN ||
      requestingUserRole === UserRole.SUPER_ADMIN;

    if (!isAdmin && payment.userId !== requestingUserId) {
      throw new ForbiddenException('You can only refund your own payments');
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      throw new BadRequestException('Payment is already refunded');
    }

    if (payment.status === PaymentStatus.REFUNDING) {
      throw new ConflictException('Refund already in progress');
    }

    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException(
        `Only SUCCESS payments can be refunded. Current status: ${payment.status}`,
      );
    }

    // Atomic reserve: SUCCESS → REFUNDING. Concurrent callers get 0 affected rows.
    const reserve = await this.paymentsRepository
      .createQueryBuilder()
      .update(Payment)
      .set({ status: PaymentStatus.REFUNDING })
      .where('id = :id', { id: paymentId })
      .andWhere('status = :status', { status: PaymentStatus.SUCCESS })
      .execute();

    if (!reserve.affected) {
      throw new ConflictException(
        'Refund already in progress or payment is no longer refundable',
      );
    }

    try {
      await this.paystackProvider.initiateRefund(payment.providerReference);
    } catch (err) {
      // Failure remains retryable — release the hold back to SUCCESS.
      await this.paymentsRepository.update(
        { id: paymentId, status: PaymentStatus.REFUNDING },
        { status: PaymentStatus.SUCCESS },
      );
      throw err;
    }

    payment.status = PaymentStatus.REFUNDED;
    return this.paymentsRepository.save(payment);
  }
}
