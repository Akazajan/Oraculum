import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { IdempotencyKey } from '../entities/idempotency-key.entity';

describe('IdempotencyCleanupService', () => {
  let service: IdempotencyCleanupService;
  const mockDelete = jest.fn().mockResolvedValue({ affected: 3 });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyCleanupService,
        {
          provide: getRepositoryToken(IdempotencyKey),
          useValue: { delete: mockDelete },
        },
      ],
    }).compile();

    service = module.get(IdempotencyCleanupService);
  });

  afterEach(() => jest.clearAllMocks());

  it('deletes expired idempotency keys', async () => {
    await service.cleanup();
    expect(mockDelete).toHaveBeenCalledWith({
      expiresAt: LessThan(expect.any(Date)),
    });
  });

  it('does not throw on repository errors', async () => {
    mockDelete.mockRejectedValueOnce(new Error('db down'));
    await expect(service.cleanup()).resolves.toBeUndefined();
  });
});
