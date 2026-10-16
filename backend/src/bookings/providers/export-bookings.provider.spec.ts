import { BadRequestException } from '@nestjs/common';
import { ExportBookingsProvider } from './export-bookings.provider';
import { UserRole } from '../../users/enums/userRoles.enum';

const makeBooking = (id: string) => ({
  id,
  userId: 'user-1',
  planType: 'HOURLY' as unknown as never,
  totalAmount: 10000,
  status: 'PENDING' as unknown as never,
  seatCount: 1,
  startDate: new Date().toISOString(),
  endDate: new Date().toISOString(),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  user: { firstname: 'A', lastname: 'B', email: 'a@b.com' },
  workspace: { id: 'w1', name: 'WS', type: 'OPEN' as unknown as never },
});

describe('ExportBookingsProvider', () => {
  let provider: ExportBookingsProvider;
  let mockGetMany: jest.Mock;
  let queryBuilder: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMany = jest.fn();

    queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: mockGetMany,
    };

    const bookingsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    provider = new ExportBookingsProvider(bookingsRepository as never);
  });

  it('returns mapped rows for a normal export', async () => {
    mockGetMany.mockResolvedValue([makeBooking('b1'), makeBooking('b2')]);

    const result = await provider.findAllForExport('user-1', UserRole.USER);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'b1', userId: 'user-1' });
    expect(queryBuilder.take).toHaveBeenCalledWith(10_000 + 1);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'booking.userId = :userId',
      { userId: 'user-1' },
    );
  });

  it('does not scope by userId for admin roles', async () => {
    mockGetMany.mockResolvedValue([]);

    await provider.findAllForExport('admin-1', UserRole.ADMIN);

    expect(queryBuilder.where).not.toHaveBeenCalled();
  });

  it('throws when the export would exceed the maximum row cap', async () => {
    mockGetMany.mockResolvedValue(
      Array.from({ length: 10_001 }, (_, i) => makeBooking(`b${i}`)),
    );

    await expect(
      provider.findAllForExport('user-1', UserRole.ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      provider.findAllForExport('user-1', UserRole.ADMIN),
    ).rejects.toThrow(/maximum allowed 10000 rows/);
  });

  it('accepts exactly the maximum number of rows', async () => {
    mockGetMany.mockResolvedValue(
      Array.from({ length: 10_000 }, (_, i) => makeBooking(`b${i}`)),
    );

    const result = await provider.findAllForExport('user-1', UserRole.ADMIN);

    expect(result).toHaveLength(10_000);
  });
});
