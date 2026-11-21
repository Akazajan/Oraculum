import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { Invoice } from './entities/invoice.entity';
import { ExportInvoicesProvider } from './providers/export-invoices.provider';
import { InvoiceStatus } from './enums/invoice-status.enum';
import { UserRole } from '../users/enums/userRoles.enum';

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

describe('InvoicesService', () => {
  let service: InvoicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getRepositoryToken(Invoice), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAll should return an array', async () => {
    mockRepo.find.mockResolvedValue([]);
    const result = await service.findAll();
    expect(Array.isArray(result)).toBe(true);
  });

  it('findOne should return null for unknown id', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const result = await service.findOne('non-existent-id');
    expect(result).toBeNull();
  });
});

describe('ExportInvoicesProvider filters', () => {
  let provider: ExportInvoicesProvider;
  let qb: Record<string, jest.Mock>;

  beforeEach(() => {
    qb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    provider = new ExportInvoicesProvider(repo as never);
  });

  it('applies the status filter like the list endpoint', async () => {
    await provider.findAllForExport('user-1', UserRole.ADMIN, undefined, undefined, {
      status: InvoiceStatus.PAID,
    });
    expect(qb.andWhere).toHaveBeenCalledWith('invoice.status = :status', {
      status: InvoiceStatus.PAID,
    });
  });

  it('applies the bookingId filter like the list endpoint', async () => {
    await provider.findAllForExport('user-1', UserRole.ADMIN, undefined, undefined, {
      bookingId: 'booking-1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('invoice.bookingId = :bookingId', {
      bookingId: 'booking-1',
    });
  });

  it('applies the date range with an inclusive end-of-day endDate', async () => {
    await provider.findAllForExport('user-1', UserRole.ADMIN, '2026-01-01', '2026-01-31');
    expect(qb.andWhere).toHaveBeenCalledWith('invoice.createdAt >= :startDate', {
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(qb.andWhere).toHaveBeenCalledWith('invoice.createdAt <= :endDate', {
      endDate: new Date('2026-01-31T23:59:59.999Z'),
    });
  });

  it('combines date and status filters', async () => {
    await provider.findAllForExport('user-1', UserRole.USER, '2026-01-01', '2026-01-31', {
      status: InvoiceStatus.PENDING,
    });
    expect(qb.where).toHaveBeenCalledWith('invoice.userId = :userId', { userId: 'user-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('invoice.status = :status', {
      status: InvoiceStatus.PENDING,
    });
    expect(qb.andWhere).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid dates', async () => {
    await expect(
      provider.findAllForExport('user-1', UserRole.ADMIN, 'not-a-date'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects startDate after endDate', async () => {
    await expect(
      provider.findAllForExport('user-1', UserRole.ADMIN, '2026-02-01', '2026-01-01'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown status values', async () => {
    await expect(
      provider.findAllForExport('user-1', UserRole.ADMIN, undefined, undefined, {
        status: 'bogus' as InvoiceStatus,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
