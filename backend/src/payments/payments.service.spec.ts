import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { PaymentsService } from './payments.service';
import { InitializePaymentProvider } from './providers/initialize-payment.provider';
import { HandleWebhookProvider } from './providers/handle-webhook.provider';
import { RefundPaymentProvider } from './providers/refund-payment.provider';
import {
  FindPaymentsProvider,
  MAX_PAGE,
  PaymentQuery,
} from './providers/find-payments.provider';
import { PaymentFailureQueryDto } from './dto/payment-failure-query.dto';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from './enums/payment-status.enum';
import { UserRole } from '../users/enums/userRoles.enum';
describe('PaymentsService', () => {
  let service: PaymentsService;
  let loggerLogSpy: jest.SpyInstance;

  const initializePaymentProvider = {
    initialize: jest.fn().mockResolvedValue({
      paymentId: 'p1',
      authorizationUrl: 'https://example.com/pay',
      reference: 'ref-1',
    }),
  };
  const handleWebhookProvider = {
    handle: jest.fn().mockResolvedValue(undefined),
  };
  const refundPaymentProvider = {
    refund: jest.fn().mockResolvedValue({ id: 'p1' }),
  };
  const findPaymentsProvider = {
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'p1' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: InitializePaymentProvider,
          useValue: initializePaymentProvider,
        },
        { provide: HandleWebhookProvider, useValue: handleWebhookProvider },
        { provide: RefundPaymentProvider, useValue: refundPaymentProvider },
        { provide: FindPaymentsProvider, useValue: findPaymentsProvider },
      ],
    }).compile();

    service = module.get(PaymentsService);
    loggerLogSpy = jest
      .spyOn(
        (service as unknown as { logger: { log: (...a: unknown[]) => void } })
          .logger,
        'log',
      )
      .mockImplementation(() => undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initialize', () => {
    it('logs the payment initialization with booking and user metadata and delegates', async () => {
      const result = await service.initialize('booking-1', 'user-1');

      expect(initializePaymentProvider.initialize).toHaveBeenCalledWith(
        'booking-1',
        'user-1',
      );
      expect(result).toEqual({
        paymentId: 'p1',
        authorizationUrl: 'https://example.com/pay',
        reference: 'ref-1',
      });
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Initializing payment'),
        expect.objectContaining({ bookingId: 'booking-1', userId: 'user-1' }),
      );
    });
  });

  describe('handleWebhook', () => {
    it('logs the webhook receipt with the extracted reference and delegates', async () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          event: 'charge.success',
          data: { reference: 'ref-1' },
        }),
      );

      await service.handleWebhook(rawBody, 'sig-1');

      expect(handleWebhookProvider.handle).toHaveBeenCalledWith(
        rawBody,
        'sig-1',
      );
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Payment webhook received'),
        expect.objectContaining({
          signaturePresent: true,
          reference: 'ref-1',
        }),
      );
    });

    it('logs the webhook receipt even when the body cannot be parsed', async () => {
      const rawBody = Buffer.from('not-json');

      await service.handleWebhook(rawBody, '');

      expect(handleWebhookProvider.handle).toHaveBeenCalledWith(rawBody, '');
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Payment webhook received'),
        expect.objectContaining({
          signaturePresent: false,
          reference: undefined,
        }),
      );
    });
  });

  describe('refund', () => {
    it('logs the refund attempt with metadata and delegates', async () => {
      const result = await service.refund(
        'payment-1',
        'user-1',
        UserRole.ADMIN,
      );

      expect(refundPaymentProvider.refund).toHaveBeenCalledWith(
        'payment-1',
        'user-1',
        UserRole.ADMIN,
      );
      expect(result).toEqual({ id: 'p1' });
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Refund requested'),
        expect.objectContaining({
          paymentId: 'payment-1',
          userId: 'user-1',
          userRole: UserRole.ADMIN,
        }),
      );
    });
  });
});


describe('payment query validation', () => {
  const errorsFor = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(PaymentQuery, plain))).map(
      (e) => e.property,
    );
  const status = Object.values(PaymentStatus)[0];

  it('accepts valid filters', async () => {
    expect(
      await errorsFor({
        status,
        fromDate: '2026-07-01',
        toDate: '2026-07-31',
        page: 1,
        limit: 20,
      }),
    ).toEqual([]);
  });

  it('rejects an unsupported status', async () => {
    expect(await errorsFor({ status: 'not-a-status' })).toContain('status');
  });

  it('rejects malformed dates', async () => {
    expect(await errorsFor({ fromDate: 'banana' })).toContain('fromDate');
    expect(await errorsFor({ toDate: '2026-13-99' })).toContain('toDate');
  });

  it('rejects toDate before fromDate', async () => {
    expect(
      await errorsFor({ fromDate: '2026-07-31', toDate: '2026-07-01' }),
    ).toContain('toDate');
  });

  it('rejects a date range longer than the maximum', async () => {
    expect(
      await errorsFor({ fromDate: '2020-01-01', toDate: '2026-01-01' }),
    ).toContain('toDate');
  });

  it('rejects out-of-bounds pages', async () => {
    expect(await errorsFor({ limit: 1000 })).toContain('limit');
    expect(await errorsFor({ page: 0 })).toContain('page');
    expect(await errorsFor({ page: MAX_PAGE + 1 })).toContain('page');
  });

  it('applies the same date validation to payment failure queries', async () => {
    const errors = await validate(
      plainToInstance(PaymentFailureQueryDto, {
        fromDate: 'banana',
        toDate: '2026-07-01',
      }),
    );
    expect(errors.map((e) => e.property)).toContain('fromDate');
  });
});

describe('FindPaymentsProvider scoping', () => {
  const makeProvider = () => {
    const qb: Record<string, jest.Mock> = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const provider = new FindPaymentsProvider(
      repo as unknown as Repository<Payment>,
    );
    return { provider, qb };
  };
  const filters = Object.assign(new PaymentQuery(), {
    status: Object.values(PaymentStatus)[0],
    fromDate: '2026-07-01',
    toDate: '2026-07-31',
  });

  it('scopes a regular user to their own payments even with filters applied', async () => {
    const { provider, qb } = makeProvider();
    await provider.findAll(filters, 'user-1', UserRole.USER);
    expect(qb.where).toHaveBeenCalledWith('payment.userId = :userId', {
      userId: 'user-1',
    });
    expect(qb.andWhere).toHaveBeenCalledTimes(3); // status, fromDate, toDate
  });

  it.each([UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    '%s is not scoped to a single user',
    async (role) => {
      const { provider, qb } = makeProvider();
      await provider.findAll(filters, 'someone', role);
      expect(qb.where).not.toHaveBeenCalled();
    },
  );

  it('includes the whole day for a date-only toDate', async () => {
    const { provider, qb } = makeProvider();
    await provider.findAll(
      Object.assign(new PaymentQuery(), { toDate: '2026-07-31' }),
      'u',
      UserRole.ADMIN,
    );
    expect(qb.andWhere).toHaveBeenCalledWith('payment.createdAt <= :toDate', {
      toDate: new Date('2026-07-31T23:59:59.999Z'),
    });
  });
});