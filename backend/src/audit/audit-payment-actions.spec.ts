import { AuditService, AuditAction } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';
import { Repository } from 'typeorm';
import { runWithRequestContext } from '../common/context/correlation-context';

describe('AuditService - Payment Actions', () => {
  let repoCreate: jest.Mock;
  let repoSave: jest.Mock;
  let service: AuditService;

  beforeEach(() => {
    repoCreate = jest.fn((row: Partial<AuditLog>) => ({
      id: 'audit-row-id',
      createdAt: new Date(),
      ...row,
    } as AuditLog));
    repoSave = jest.fn(async (row: AuditLog) => row);
    const repo = { create: repoCreate, save: repoSave } as unknown as Repository<AuditLog>;
    service = new AuditService(repo);
  });

  describe('paymentFailure', () => {
    it('logs a payment failure with structured metadata', async () => {
      await runWithRequestContext(
        { correlationId: 'cid-pay-fail-1', request: { ip: '10.0.0.1', userAgent: 'jest' } },
        async () => {
          await service.paymentFailure('payment-123', 'user-456', {
            paymentReference: 'ref-abc',
            amount: 50000,
            currency: 'NGN',
            provider: 'paystack',
            errorCode: 'CHARGE_FAILED',
            errorMessage: 'Paystack charge.failed webhook received',
            providerResponse: null,
          });
        },
      );

      expect(repoCreate).toHaveBeenCalledTimes(1);
      const row = repoCreate.mock.calls[0][0] as Partial<AuditLog>;
      expect(row).toMatchObject({
        action: AuditAction.PAYMENT_FAILED,
        outcome: 'FAILURE',
        actorId: 'user-456',
        resourceType: 'Payment',
        resourceId: 'payment-123',
        correlationId: 'cid-pay-fail-1',
      });
      expect(row.metadata).toMatchObject({
        paymentReference: 'ref-abc',
        amount: 50000,
        provider: 'paystack',
        errorCode: 'CHARGE_FAILED',
      });
    });

    it('logs without userId for anonymous', async () => {
      await service.paymentFailure('payment-789', null, {
        paymentReference: 'ref-anon',
        errorCode: 'CHARGE_FAILED',
        errorMessage: 'Charge failed',
      });

      const row = repoCreate.mock.calls[0][0] as Partial<AuditLog>;
      expect(row.action).toBe(AuditAction.PAYMENT_FAILED);
      expect(row.outcome).toBe('FAILURE');
      expect(row.actorId).toBeNull();
      expect(row.resourceType).toBe('Payment');
    });
  });

  describe('paymentSuccess', () => {
    it('logs a payment success with structured metadata', async () => {
      await service.paymentSuccess('payment-abc', 'user-xyz', {
        paymentReference: 'ref-123',
        amount: 100000,
        currency: 'NGN',
        provider: 'paystack',
        bookingId: 'booking-001',
      });

      const row = repoCreate.mock.calls[0][0] as Partial<AuditLog>;
      expect(row).toMatchObject({
        action: AuditAction.PAYMENT_SUCCESS,
        outcome: 'SUCCESS',
        actorId: 'user-xyz',
        resourceType: 'Payment',
        resourceId: 'payment-abc',
      });
      expect(row.metadata).toMatchObject({
        paymentReference: 'ref-123',
        amount: 100000,
        bookingId: 'booking-001',
      });
    });
  });

  describe('payment action codes', () => {
    it('PAYMENT_FAILED exists', () => expect(AuditAction.PAYMENT_FAILED).toBe('PAYMENT_FAILED'));
    it('PAYMENT_SUCCESS exists', () => expect(AuditAction.PAYMENT_SUCCESS).toBe('PAYMENT_SUCCESS'));
    it('PAYMENT_INITIATED exists', () => expect(AuditAction.PAYMENT_INITIATED).toBe('PAYMENT_INITIATED'));
    it('PAYMENT_REFUNDED exists', () => expect(AuditAction.PAYMENT_REFUNDED).toBe('PAYMENT_REFUNDED'));
  });
});
