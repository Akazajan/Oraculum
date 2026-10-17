import { CreateBookingProvider } from './providers/create-booking.provider';
import { BookingsService } from './bookings.service';
import { PricingService } from './pricing/pricing.service';
import { PlanType } from './enums/plan-type.enum';
import { RecurrenceFrequency } from './enums/recurrence-frequency.enum';
import { RecurringBookingConflictException } from './exceptions/recurring-booking-conflict.exception';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { Booking } from './entities/booking.entity';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function baseDto(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    planType: PlanType.DAILY,
    seatCount: 2,
    startDate: '2026-04-01',
    endDate: '2026-04-02',
    recurrenceFrequency: RecurrenceFrequency.WEEKLY,
    occurrenceCount: 3,
    ...overrides,
  };
}

interface FakeManagerState {
  workspace: any;
  /** key `${startDate}|${endDate}` -> already-booked seats */
  bookedByWindow: Record<string, number>;
  overlapCalls: string[];
  saved: any[] | null;
  saveCalls: number;
}

/** Build a minimal EntityManager double honouring the provider's query shape. */
function buildHarness(state: FakeManagerState) {
  const manager: any = {
    createQueryBuilder: jest.fn((entity: unknown) => {
      if (entity === Workspace) {
        const qb: any = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(state.workspace),
        };
        return qb;
      }
      // Booking overlap query
      const params: Record<string, string> = {};
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn((_clause: string, p?: Record<string, string>) => {
          Object.assign(params, p);
          return qb;
        }),
        setLock: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockImplementation(async () => {
          const key = `${params.startDate}|${params.endDate}`;
          state.overlapCalls.push(key);
          return { booked: String(state.bookedByWindow[key] ?? 0) };
        }),
      };
      return qb;
    }),
    create: jest.fn((_entity: unknown, data: any) => {
      if (Array.isArray(data)) return data.map((d, i) => ({ id: `b-${i}`, ...d }));
      return { id: 'b-0', ...data };
    }),
    save: jest.fn(async (entities: any) => {
      state.saveCalls += 1;
      const arr = Array.isArray(entities) ? entities : [entities];
      state.saved = arr;
      return arr;
    }),
  };

  const transaction = jest.fn(async (work: (m: unknown) => Promise<unknown>) => work(manager));

  const provider = new CreateBookingProvider(
    {} as never,
    {} as never,
    new PricingService(),
    { transaction } as never,
    { sendBookingCreatedEmail: jest.fn() } as never,
    { invalidateBookingList: jest.fn().mockResolvedValue(undefined) } as never,
  );

  return { manager, transaction, provider };
}

describe('BookingsService.createRecurring (BE-29 atomic series)', () => {
  const workspace = {
    id: WORKSPACE_ID,
    name: 'WS',
    totalSeats: 10,
    hourlyRate: 500000,
    isActive: true,
  };

  it('persists all occurrences when zero conflicts exist', async () => {
    const state: FakeManagerState = {
      workspace,
      bookedByWindow: {},
      overlapCalls: [],
      saved: null,
      saveCalls: 0,
    };
    const { transaction, manager, provider } = buildHarness(state);

    const result = await provider.createRecurring(baseDto() as never, USER_ID);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
    expect(manager.save).toHaveBeenCalledTimes(1);
    // Weekly expansion from 2026-04-01
    expect(result.map((b: Booking) => b.startDate)).toEqual([
      '2026-04-01',
      '2026-04-08',
      '2026-04-15',
    ]);
    expect(state.overlapCalls).toHaveLength(3);
    expect(state.saved).toHaveLength(3);
  });

  it('rolls back the entire series when occurrence k collides (zero partial persistence)', async () => {
    const state: FakeManagerState = {
      workspace,
      // Second occurrence (index 1 => 2026-04-08..2026-04-09) is fully booked
      bookedByWindow: { '2026-04-08|2026-04-09': 10 },
      overlapCalls: [],
      saved: null,
      saveCalls: 0,
    };
    const { transaction, manager, provider } = buildHarness(state);

    await expect(provider.createRecurring(baseDto() as never, USER_ID)).rejects.toBeInstanceOf(
      RecurringBookingConflictException,
    );

    // Single transaction boundary, and save never ran => nothing persisted.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.save).not.toHaveBeenCalled();
    expect(state.saved).toBeNull();
  });

  it('conflict error response identifies occurrence date, window and reason without stack traces', async () => {
    const state: FakeManagerState = {
      workspace,
      bookedByWindow: { '2026-04-08|2026-04-09': 9 },
      overlapCalls: [],
      saved: null,
      saveCalls: 0,
    };
    const { provider } = buildHarness(state);

    // seatCount=2, booked=9, total=10 => only 1 available at occurrence index 1
    const err = await provider
      .createRecurring(baseDto({ seatCount: 2 }) as never, USER_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RecurringBookingConflictException);
    const res = (err as RecurringBookingConflictException).getResponse() as Record<string, unknown>;
    expect(res.statusCode).toBe(409);
    expect(res.occurrenceIndex).toBe(1);
    expect(res.startDate).toBe('2026-04-08');
    expect(res.endDate).toBe('2026-04-09');
    expect(typeof res.reason).toBe('string');
    expect(typeof res.message).toBe('string');
    expect(res.stack).toBeUndefined();
    expect(JSON.stringify(res)).not.toMatch(/at .*\(.*\.ts:/);
  });

  it('delegates BookingsService.createRecurring to the provider', async () => {
    const created = [{ id: 'b-0' }, { id: 'b-1' }] as Booking[];
    const createRecurring = jest.fn().mockResolvedValue(created);
    const service = new BookingsService(
      { create: jest.fn(), createRecurring } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const dto = baseDto() as never;
    await expect(service.createRecurring(dto, USER_ID)).resolves.toBe(created);
    expect(createRecurring).toHaveBeenCalledWith(dto, USER_ID);
  });
});
