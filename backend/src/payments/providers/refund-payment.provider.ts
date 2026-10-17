import {
  BadRequestException,
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
 * Currency-safe integer helpers for minor units (kobo, cents, …).
 * Never use floating-point arithmetic on money amounts (BE-47).
 */
export function toMinorUnits(value: number | string | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new BadRequestException(
        'Refund amounts must be whole minor units (no fractional currency)',
      );
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value.trim())) {
    throw new BadRequestException(
      'Refund amounts must be whole minor units (no fractional currency)',
    );
  }
  return BigInt(value.trim());
}

export function assertRefundWithinCaptured(
  amount: number | string | bigint,
  alreadyRefunded: number | string | bigint,
  refundRequest: number | string | bigint,
): { nextRefunded: bigint; remainingAfter: bigint } {
  const captured = toMinorUnits(amount);
  const refunded = toMinorUnits(alreadyRefunded);
  const request = toMinorUnits(refundRequest);

  if (request <= 0n) {
    throw new BadRequestException('Refund amount must be greater than zero');
  }
  if (refunded < 0n || captured < 0n) {
    throw new BadRequestException('Payment amounts are invalid');
  }
  if (refunded > captured) {
    throw new BadRequestException(
      'Payment refund ledger is inconsistent: refunded exceeds captured',
    );
  }
  const remaining = captured - refunded;
  if (request > remaining) {
    throw new BadRequestException(
      `Refund of ${request} exceeds remaining refundable balance of ${remaining}`,
    );
  }
  const nextRefunded = refunded + request;
  return { nextRefunded, remainingAfter: captured - nextRefunded };
}

/**
 * Refunds a payment in full or in part.
 *
 * Tracks cumulative `refundedAmount` on the Payment row and rejects any
 * request that would exceed the original captured amount (BE-47).
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
    /**
     * Optional partial amount in minor units. When omitted, refunds the
     * entire remaining balance.
     */
    amount?: number,
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

    if (
      payment.status !== PaymentStatus.SUCCESS &&
      payment.status !== PaymentStatus.REFUNDED
    ) {
      throw new BadRequestException(
        `Only SUCCESS (or partially refunded) payments can be refunded. Current status: ${payment.status}`,
      );
    }

    const remaining = toMinorUnits(payment.amount) - toMinorUnits(payment.refundedAmount ?? 0);
    if (remaining <= 0n) {
      throw new BadRequestException('Payment has already been fully refunded');
    }

    const requestAmount =
      amount === undefined || amount === null
        ? remaining
        : toMinorUnits(amount);

    const { nextRefunded, remainingAfter } = assertRefundWithinCaptured(
      payment.amount,
      payment.refundedAmount ?? 0,
      requestAmount,
    );

    await this.paystackProvider.initiateRefund(
      payment.providerReference,
      // Pass minor units as number when safe; provider accepts full or partial.
      Number(requestAmount),
    );

    payment.refundedAmount = Number(nextRefunded);
    payment.status =
      remainingAfter === 0n ? PaymentStatus.REFUNDED : PaymentStatus.SUCCESS;
    if (!payment.metadata) payment.metadata = {};
    payment.metadata = {
      ...payment.metadata,
      lastRefundAmount: Number(requestAmount),
      lastRefundAt: new Date().toISOString(),
    };

    return this.paymentsRepository.save(payment);
  }
}
