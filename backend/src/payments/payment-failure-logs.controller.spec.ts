import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentFailureLogsController } from './payment-failure-logs.controller';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditAction } from '../audit/audit.service';

describe('PaymentFailureLogsController', () => {
  let controller: PaymentFailureLogsController;

  const mockQb = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentFailureLogsController],
      providers: [
        {
          provide: getRepositoryToken(AuditLog),
          useValue: { createQueryBuilder: jest.fn(() => mockQb) },
        },
      ],
    }).compile();

    controller = module.get(PaymentFailureLogsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('filters by PAYMENT_FAILED action', async () => {
    await controller.list({ page: 1, limit: 20 });
    expect(mockQb.andWhere).toHaveBeenCalledWith('a.action = :action', {
      action: AuditAction.PAYMENT_FAILED,
    });
  });

  it('applies userId filter', async () => {
    await controller.list({ page: 1, limit: 20, userId: 'u-1' });
    expect(mockQb.andWhere).toHaveBeenCalledWith('a.actorId = :userId', { userId: 'u-1' });
  });

  it('applies paymentId filter', async () => {
    await controller.list({ page: 1, limit: 20, paymentId: 'p-1' });
    expect(mockQb.andWhere).toHaveBeenCalledWith('a.resourceId = :paymentId', { paymentId: 'p-1' });
  });

  it('applies provider filter', async () => {
    await controller.list({ page: 1, limit: 20, provider: 'paystack' });
    expect(mockQb.andWhere).toHaveBeenCalledWith("a.metadata->>'provider' = :provider", { provider: 'paystack' });
  });

  it('applies date range', async () => {
    await controller.list({ page: 1, limit: 20, fromDate: '2026-07-01', toDate: '2026-07-31' });
    expect(mockQb.andWhere).toHaveBeenCalledWith('a.createdAt >= :fromDate', { fromDate: new Date('2026-07-01') });
    expect(mockQb.andWhere).toHaveBeenCalledWith('a.createdAt <= :toDate', { toDate: new Date('2026-07-31') });
  });

  it('applies search filter', async () => {
    await controller.list({ page: 1, limit: 20, search: 'ERR' });
    expect(mockQb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE :search'), { search: '%ERR%' });
  });
});
