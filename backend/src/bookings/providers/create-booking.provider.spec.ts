import { BadRequestException, ConflictException } from '@nestjs/common';
import { CreateBookingProvider } from './create-booking.provider';
import { BookingStatus } from '../enums/booking-status.enum';
import { Workspace } from '../../workspaces/entities/workspace.entity';

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

  it('serializes concurrent transactions before checking workspace capacity', async () => {
    const bookings: Array<{
      startDate: string;
      endDate: string;
      seatCount: number;
      status: BookingStatus;
    }> = [];
    const workspace = {
      id: 'workspace-1',
      isActive: true,
      totalSeats: 2,
      hourlyRate: 100,
      name: 'Test workspace',
    };
    let workspaceLocked = false;
    const lockWaiters: Array<() => void> = [];
    const acquireWorkspaceLock = async () => {
      if (!workspaceLocked) {
        workspaceLocked = true;
        return;
      }
      await new Promise<void>((resolve) => lockWaiters.push(resolve));
    };
    const releaseWorkspaceLock = () => {
      const nextWaiter = lockWaiters.shift();
      if (nextWaiter) {
        nextWaiter();
      } else {
        workspaceLocked = false;
      }
    };

    const dataSource = {
      transaction: jest.fn(async (callback) => {
        let ownsWorkspaceLock = false;
        const manager = {
          createQueryBuilder: jest.fn((entity) => {
            if (entity === Workspace) {
              let lockRequested = false;
              const builder = {
                setLock: jest.fn(() => {
                  lockRequested = true;
                  return builder;
                }),
                where: jest.fn().mockReturnThis(),
                getOne: jest.fn(async () => {
                  if (lockRequested) {
                    await acquireWorkspaceLock();
                    ownsWorkspaceLock = true;
                  }
                  return workspace;
                }),
              };
              return builder;
            }

            const builder = {
              select: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getRawOne: jest.fn(async () => ({
                booked: String(
                  bookings
                    .filter(
                      (booking) =>
                        booking.status === BookingStatus.PENDING ||
                        booking.status === BookingStatus.CONFIRMED,
                    )
                    .reduce((total, booking) => total + booking.seatCount, 0),
                ),
              })),
            };
            return builder;
          }),
          create: jest.fn((_entity, value) => value),
          save: jest.fn(async (booking) => {
            bookings.push(booking);
            return { id: `booking-${bookings.length}`, ...booking };
          }),
        };

        try {
          return await callback(manager);
        } finally {
          if (ownsWorkspaceLock) {
            releaseWorkspaceLock();
          }
        }
      }),
    };
    const provider = new CreateBookingProvider(
      {} as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { calculateAmount: jest.fn().mockReturnValue(100) } as never,
      dataSource as never,
      {} as never,
      { invalidateBookingList: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const request = {
      workspaceId: 'workspace-1',
      planType: 'hourly' as never,
      startDate: '2026-10-16',
      endDate: '2026-10-17',
      seatCount: 2,
    };

    const results = await Promise.allSettled([
      provider.create(request, 'user-1'),
      provider.create(request, 'user-2'),
    ]);

    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      ConflictException,
    );
    expect(bookings.reduce((total, booking) => total + booking.seatCount, 0)).toBe(2);
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
