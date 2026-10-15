import { BadRequestException } from '@nestjs/common';
import { CreateBookingProvider } from './create-booking.provider';
import { BookingStatus } from '../enums/booking-status.enum';

describe('CreateBookingProvider interval overlap checks', () => {
  const queryBuilder = () => ({
    select: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({
      id: 'workspace-1',
      isActive: true,
      totalSeats: 2,
      hourlyRate: 100,
      name: 'Test workspace',
    }),
    getRawOne: jest.fn().mockResolvedValue({ booked: '0' }),
  });

  it('allows an adjacent booking because the end boundary is exclusive', async () => {
    const workspaceQuery = queryBuilder();
    const bookingQuery = queryBuilder();
    const manager = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(workspaceQuery)
        .mockReturnValueOnce(bookingQuery),
      create: jest.fn((_entity, value) => value),
      save: jest.fn().mockResolvedValue({ id: 'booking-1' }),
    };
    const provider = new CreateBookingProvider(
      {} as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { calculateAmount: jest.fn().mockReturnValue(100) } as never,
      { transaction: jest.fn((callback) => callback(manager)) } as never,
      {} as never,
      {
        invalidateBookingList: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await provider.create(
      {
        workspaceId: 'workspace-1',
        planType: 'hourly' as never,
        startDate: '2026-10-16',
        endDate: '2026-10-17',
        seatCount: 1,
      },
      'user-1',
    );

    expect(bookingQuery.andWhere).toHaveBeenCalledWith(
      'b.startDate < :endDate',
      { endDate: '2026-10-17' },
    );
    expect(bookingQuery.andWhere).toHaveBeenCalledWith(
      'b.endDate > :startDate',
      { startDate: '2026-10-16' },
    );
    expect(bookingQuery.andWhere).toHaveBeenCalledWith(
      'b.status IN (:...statuses)',
      { statuses: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
    );
  });

  it('rejects a booking whose end is not after its start', async () => {
    const provider = new CreateBookingProvider(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      provider.create(
        {
          workspaceId: 'workspace-1',
          planType: 'hourly' as never,
          startDate: '2026-10-17',
          endDate: '2026-10-17',
          seatCount: 1,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
