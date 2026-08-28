import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { BookingsService } from '../../bookings/bookings.service';
import { Booking } from '../../bookings/entities/booking.entity';
import { BookingStatus } from '../../bookings/enums/booking-status.enum';
import { PlanType } from '../../bookings/enums/plan-type.enum';
import { CacheInvalidationProvider } from '../../common/providers/cache-invalidation.provider';
import { EmailService } from '../../email/email.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { User } from '../../users/entities/user.entity';
import { MembershipStatus } from '../../users/enums/membership-status.enum';
import { Payment } from '../entities/payment.entity';
import { PaymentProvider } from '../enums/payment-provider.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import { PaystackProvider } from './paystack.provider';
import { SorobanEscrowProvider } from './soroban-escrow.provider';
import { ConfirmBookingProvider } from '../../bookings/providers/confirm-booking.provider';
import { HandleWebhookProvider } from './handle-webhook.provider';

type InMemoryStore = {
  payment: Payment;
  booking: Booking;
  user: User;
};

function createInMemoryManager(store: InMemoryStore): EntityManager {
  return {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Payment) return store.payment;
      if (entity === Booking) return store.booking;
      if (entity === User) return store.user;
      return null;
    }),
    save: jest.fn(async (entity: Payment | Booking | User) => entity),
    update: jest.fn(async (_entity: unknown, _id: string, changes: Partial<Booking>) => {
      Object.assign(store.booking, changes);
      return { affected: 1 };
    }),
  } as unknown as EntityManager;
}

describe('HandleWebhookProvider booking-payment confirmation', () => {
  const paymentReference = 'paystack-reference-123';
  const bookingId = 'booking-123';
  const userId = 'user-123';

  function createProvider(store: InMemoryStore) {
    const manager = createInMemoryManager(store);
    const dataSource = {
      transaction: jest.fn(async (work: (transactionManager: EntityManager) => unknown) =>
        work(manager),
      ),
    } as unknown as DataSource;

    const confirmBookingProvider = new ConfirmBookingProvider(
      {} as never,
      {} as never,
      dataSource,
      { invalidateBookingList: jest.fn().mockResolvedValue(undefined) } as unknown as CacheInvalidationProvider,
    );
    const bookingsService = {
      confirm: (id: string, transactionManager: EntityManager) =>
        confirmBookingProvider.confirm(id, transactionManager),
    } as unknown as BookingsService;

    const paystackProvider = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    } as unknown as PaystackProvider;
    const sorobanEscrowProvider = {
      createEscrow: jest.fn(),
    } as unknown as SorobanEscrowProvider;
    const invoicesService = {
      generateForPayment: jest.fn().mockResolvedValue(undefined),
    } as unknown as InvoicesService;
    const notificationsService = {
      create: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const emailService = {
      sendPaymentSuccessEmail: jest.fn().mockResolvedValue(undefined),
    } as unknown as EmailService;
    const auditService = {
      paymentSuccess: jest.fn(),
    } as unknown as AuditService;
    const configService = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const provider = new HandleWebhookProvider(
      {} as never,
      { findOne: jest.fn().mockResolvedValue(store.booking) } as never,
      { findOne: jest.fn().mockResolvedValue(store.user) } as never,
      paystackProvider,
      sorobanEscrowProvider,
      bookingsService,
      invoicesService,
      notificationsService,
      emailService,
      auditService,
      configService,
      dataSource,
    );

    return { provider, dataSource, paystackProvider };
  }

  function createStore(): InMemoryStore {
    return {
      payment: {
        id: 'payment-123',
        bookingId,
        userId,
        amount: 25000,
        currency: 'NGN',
        provider: PaymentProvider.PAYSTACK,
        providerReference: paymentReference,
        status: PaymentStatus.PENDING,
      } as Payment,
      booking: {
        id: bookingId,
        userId,
        workspaceId: 'workspace-123',
        planType: PlanType.DAILY,
        status: BookingStatus.PENDING,
        endDate: '2026-09-01',
      } as Booking,
      user: {
        id: userId,
        email: 'member@example.com',
        fullName: 'Test Member',
        membershipStatus: MembershipStatus.INACTIVE,
        memberSince: null,
      } as User,
    };
  }

  it('rejects a webhook with an invalid signature without changing state', async () => {
    const store = createStore();
    const { provider, paystackProvider, dataSource } = createProvider(store);
    (paystackProvider.verifyWebhookSignature as jest.Mock).mockReturnValue(false);

    const payload = Buffer.from(JSON.stringify({ event: 'charge.success', data: {} }));

    await expect(provider.handle(payload, 'invalid-signature')).rejects.toThrow(
      new UnauthorizedException('Invalid Paystack webhook signature'),
    );

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(store.payment.status).toBe(PaymentStatus.PENDING);
    expect(store.booking.status).toBe(BookingStatus.PENDING);
  });

  it('marks the payment successful and confirms the booking in one transaction', async () => {
    const store = createStore();
    const { provider, dataSource } = createProvider(store);
    const webhookData = {
      reference: paymentReference,
      amount: store.payment.amount,
      channel: 'card',
    };

    await provider.handle(
      Buffer.from(JSON.stringify({ event: 'charge.success', data: webhookData })),
      'valid-signature',
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(store.payment.status).toBe(PaymentStatus.SUCCESS);
    expect(store.payment.paidAt).toBeInstanceOf(Date);
    expect(store.payment.metadata).toEqual(webhookData);
    expect(store.booking.status).toBe(BookingStatus.CONFIRMED);
    expect(store.user.membershipStatus).toBe(MembershipStatus.ACTIVE);
    expect(store.user.memberSince).toBeInstanceOf(Date);
  });

  it('rejects malformed JSON before opening a transaction', async () => {
    const store = createStore();
    const { provider, dataSource } = createProvider(store);

    await expect(provider.handle(Buffer.from('{'), 'valid-signature')).rejects.toThrow(
      new BadRequestException('Malformed webhook payload'),
    );

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
