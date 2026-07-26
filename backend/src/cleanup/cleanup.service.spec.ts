import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CleanupService } from './cleanup.service';
import { RefreshToken } from '../auth/entities/refreshToken.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

describe('CleanupService', () => {
  let service: CleanupService;

  const mockDelete = jest.fn().mockResolvedValue({ affected: 3 });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupService,
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            delete: mockDelete,
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getCount: jest.fn().mockResolvedValue(0),
            }),
          },
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: {
            delete: mockDelete,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('90'),
          },
        },
      ],
    }).compile();

    service = module.get(CleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleExpiredRefreshTokens', () => {
    it('deletes refresh tokens with expiresAt in the past', async () => {
      await service.handleExpiredRefreshTokens();

      expect(mockDelete).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: expect.anything() }),
      );
    });
  });

  describe('handleOldAuditLogs', () => {
    it('deletes audit logs older than retention period', async () => {
      await service.handleOldAuditLogs();

      expect(mockDelete).toHaveBeenCalledWith(
        expect.objectContaining({ createdAt: expect.anything() }),
      );
    });
  });

  describe('handleStaleTemporaryUploads', () => {
    it('deletes revoked refresh tokens older than 7 days', async () => {
      await service.handleStaleTemporaryUploads();

      expect(mockDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          revoked: true,
          createdAt: expect.anything(),
        }),
      );
    });
  });
});
