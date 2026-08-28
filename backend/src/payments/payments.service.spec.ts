import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { InitializePaymentProvider } from './providers/initialize-payment.provider';
import { HandleWebhookProvider } from './providers/handle-webhook.provider';
import { RefundPaymentProvider } from './providers/refund-payment.provider';
import { FindPaymentsProvider } from './providers/find-payments.provider';
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
