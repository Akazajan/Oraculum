import { BadRequestException } from '@nestjs/common';
import { CheckWorkspaceAvailabilityProvider } from './check-workspace-availability.provider';
import { BookingStatus } from '../../bookings/enums/booking-status.enum';

describe('CheckWorkspaceAvailabilityProvider', () => {
  const workspace = {
    id: 'workspace-1',
    isActive: true,
    totalSeats: 5,
    availableSeats: 5,
  };

  it('uses the same half-open overlap rule as booking creation', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ booked: '3' }),
    };
    const provider = new CheckWorkspaceAvailabilityProvider(
      { createQueryBuilder: jest.fn().mockReturnValue(query) } as never,
      { findById: jest.fn().mockResolvedValue(workspace) } as never,
    );

    const result = await provider.check(
      'workspace-1',
      2,
      '2026-10-16',
      '2026-10-17',
    );

    expect(query.andWhere).toHaveBeenCalledWith(
      'b.startDate < :endDate',
      { endDate: '2026-10-17' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'b.endDate > :startDate',
      { startDate: '2026-10-16' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'b.status IN (:...statuses)',
      { statuses: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
    );
    expect(result).toEqual({
      available: true,
      availableSeats: 2,
      totalSeats: 5,
      message: undefined,
    });
  });

  it('preserves legacy availability when no date range is supplied', async () => {
    const provider = new CheckWorkspaceAvailabilityProvider(
      { createQueryBuilder: jest.fn() } as never,
      {
        findById: jest
          .fn()
          .mockResolvedValue({ ...workspace, availableSeats: 2 }),
      } as never,
    );

    await expect(provider.check('workspace-1', 2)).resolves.toEqual({
      available: true,
      availableSeats: 2,
      totalSeats: 5,
      message: undefined,
    });
  });

  it('rejects incomplete or invalid date ranges', async () => {
    const provider = new CheckWorkspaceAvailabilityProvider(
      { createQueryBuilder: jest.fn() } as never,
      { findById: jest.fn().mockResolvedValue(workspace) } as never,
    );

    await expect(
      provider.check('workspace-1', 1, '2026-10-16'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      provider.check('workspace-1', 1, '2026-10-17', '2026-10-17'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
