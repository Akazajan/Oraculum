import { ConflictException, BadRequestException } from '@nestjs/common';
import { RefundPaymentProvider } from './refund-payment.provider';
import { PaymentStatus } from '../enums/payment-status.enum';
import { UserRole } from '../../users/enums/userRoles.enum';

describe('RefundPaymentProvider (BE-46)', () => {
  const paymentId = 'pay-1';
  let repo: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
  };
  let paystack: { initiateRefund: jest.Mock };
  let provider: RefundPaymentProvider;

  beforeEach(() => {
    const execute = jest.fn().mockResolvedValue({ affected: 1 });
    const andWhere = jest.fn().mockReturnValue({ execute });
    const where = jest.fn().mockReturnValue({ andWhere });
    const set = jest.fn().mockReturnValue({ where });
    const updateQb = jest.fn().mockReturnValue({ set });

    repo = {
      findOne: jest.fn().mockResolvedValue({
        id: paymentId,
        userId: 'user-1',
        status: PaymentStatus.SUCCESS,
        providerReference: 'ref-1',
      }),
      createQueryBuilder: jest.fn().mockReturnValue({ update: updateQb }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(async (p) => p),
    };
    // re-bind chain on createQueryBuilder().update()
    repo.createQueryBuilder = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            andWhere: jest.fn().mockReturnValue({
              execute: jest.fn().mockResolvedValue({ affected: 1 }),
            }),
          }),
        }),
      }),
    });

    paystack = { initiateRefund: jest.fn().mockResolvedValue(undefined) };
    provider = new RefundPaymentProvider(repo as any, paystack as any);
  });

  it('reserves SUCCESS→REFUNDING before calling the provider', async () => {
    await provider.refund(paymentId, 'user-1', UserRole.USER);
    expect(repo.createQueryBuilder).toHaveBeenCalled();
    expect(paystack.initiateRefund).toHaveBeenCalledWith('ref-1');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentStatus.REFUNDED }),
    );
  });

  it('only one concurrent reserve wins (second gets Conflict)', async () => {
    repo.createQueryBuilder = jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            andWhere: jest.fn().mockReturnValue({
              execute: jest.fn().mockResolvedValue({ affected: 0 }),
            }),
          }),
        }),
      }),
    });

    await expect(
      provider.refund(paymentId, 'user-1', UserRole.USER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paystack.initiateRefund).not.toHaveBeenCalled();
  });

  it('rolls back to SUCCESS when provider fails so refund is retryable', async () => {
    paystack.initiateRefund.mockRejectedValue(new Error('upstream'));
    await expect(
      provider.refund(paymentId, 'user-1', UserRole.USER),
    ).rejects.toThrow('upstream');
    expect(repo.update).toHaveBeenCalledWith(
      { id: paymentId, status: PaymentStatus.REFUNDING },
      { status: PaymentStatus.SUCCESS },
    );
  });

  it('rejects already-refunded payments without calling provider', async () => {
    repo.findOne.mockResolvedValue({
      id: paymentId,
      userId: 'user-1',
      status: PaymentStatus.REFUNDED,
      providerReference: 'ref-1',
    });
    await expect(
      provider.refund(paymentId, 'user-1', UserRole.USER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paystack.initiateRefund).not.toHaveBeenCalled();
  });
});
