import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExecutionContext } from '@nestjs/common';
import { IdempotencyGuard } from './idempotency.guard';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { Observable, of, Subject, throwError } from 'rxjs';

describe('IdempotencyGuard', () => {
  let guard: IdempotencyGuard;

  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyGuard,
        { provide: getRepositoryToken(IdempotencyKey), useValue: mockRepo },
      ],
    }).compile();

    guard = module.get(IdempotencyGuard);
  });

  beforeEach(() => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockImplementation((row) => row);
    mockRepo.save.mockImplementation(async (row) => row);
    mockRepo.update.mockResolvedValue({ affected: 1 });
    mockRepo.delete.mockResolvedValue({ affected: 1 });
  });

  afterEach(() => jest.clearAllMocks());

  function mockContext(overrides: Record<string, unknown> = {}) {
    const req = {
      method: 'POST',
      url: '/payments/initialize',
      route: { path: '/payments/initialize' },
      headers: {},
      body: { bookingId: '123e4567-e89b-12d3-a456-426614174000' },
      user: { id: 'user-1' },
      ...overrides,
    };
    const res = { statusCode: 201 };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  function observe(result$: Observable<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      result$.subscribe({ next: resolve, error: reject });
    });
  }

  function requestContext(key: string, body?: Record<string, unknown>) {
    return mockContext({
      headers: { 'idempotency-key': key },
      ...(body ? { body } : {}),
    });
  }

  it('skips for unauthenticated requests', async () => {
    const ctx = mockContext({ user: undefined });
    const handler = { handle: () => of({ data: 'ok' }) };
    const result = await observe(guard.intercept(ctx, handler as any));
    expect(result).toEqual({ data: 'ok' });
  });

  it('allows a first request and replays its original result for the same key and payload', async () => {
    const responseData = { message: 'Booking created', data: { id: 'booking-1' } };
    const body = { bookingId: 'booking-1', startDate: '2026-10-16' };
    const firstHandler = { handle: jest.fn(() => of(responseData)) };

    expect(
      await observe(
        guard.intercept(requestContext('booking-key-1', body), firstHandler as any),
      ),
    ).toEqual(responseData);
    expect(firstHandler.handle).toHaveBeenCalledTimes(1);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);

    const savedReservation = mockRepo.save.mock.calls[0][0];
    const savedResponse = mockRepo.update.mock.calls[0][1];
    mockRepo.findOne.mockResolvedValue({
      ...savedReservation,
      ...savedResponse,
      statusCode: 201,
    });
    const replayHandler = { handle: jest.fn() };
    const replayContext = requestContext('booking-key-1', {
      startDate: '2026-10-16',
      bookingId: 'booking-1',
    });

    expect(
      await observe(guard.intercept(replayContext, replayHandler as any)),
    ).toEqual(responseData);
    expect(replayHandler.handle).not.toHaveBeenCalled();
    expect(
      (replayContext as any).switchToHttp().getResponse().statusCode,
    ).toBe(201);
    expect(mockRepo.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a different payload without replacing the original result', async () => {
    const firstBody = { workspaceId: 'workspace-1' };
    const firstHandler = {
      handle: jest.fn(() => of({ data: { id: 'booking-1' } })),
    };
    await observe(
      guard.intercept(requestContext('booking-key-2', firstBody), firstHandler as any),
    );
    const originalSavedData = mockRepo.update.mock.calls[0][1];
    const savedReservation = mockRepo.save.mock.calls[0][0];
    mockRepo.findOne.mockResolvedValue({
      ...savedReservation,
      ...originalSavedData,
      expiresAt: new Date(Date.now() + 3600000),
    });

    const conflictHandler = { handle: jest.fn() };
    await expect(
      observe(
        guard.intercept(
          requestContext('booking-key-2', { workspaceId: 'workspace-2' }),
          conflictHandler as any,
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(conflictHandler.handle).not.toHaveBeenCalled();
    expect(mockRepo.update).toHaveBeenCalledTimes(1);
    expect(mockRepo.delete).not.toHaveBeenCalled();
  });

  it('treats different keys as independent requests', async () => {
    const handler = { handle: jest.fn(() => of({ ok: true })) };

    await observe(guard.intercept(requestContext('booking-key-a'), handler as any));
    await observe(guard.intercept(requestContext('booking-key-b'), handler as any));

    expect(handler.handle).toHaveBeenCalledTimes(2);
    expect(mockRepo.save).toHaveBeenCalledTimes(2);
  });

  it('releases a failed reservation so the same key can be retried', async () => {
    const failedHandler = {
      handle: () => throwError(() => new Error('booking failed')),
    };
    await expect(
      observe(
        guard.intercept(requestContext('booking-key-retry'), failedHandler as any),
      ),
    ).rejects.toThrow('booking failed');
    expect(mockRepo.delete).toHaveBeenCalledTimes(1);

    mockRepo.findOne.mockResolvedValue(null);
    const retryResponse = { data: { id: 'booking-retry' } };
    expect(
      await observe(
        guard.intercept(
          requestContext('booking-key-retry'),
          { handle: () => of(retryResponse) } as any,
        ),
      ),
    ).toEqual(retryResponse);
    expect(mockRepo.save).toHaveBeenCalledTimes(2);
  });

  it('preserves content-derived idempotency when no key header is supplied', async () => {
    const handler = { handle: jest.fn(() => of({ ok: true })) };

    await observe(guard.intercept(mockContext({ headers: {} }), handler as any));

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(mockRepo.findOne).toHaveBeenCalled();
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  it('shares one in-progress result for concurrent requests with the same key', async () => {
    let storedRow: Record<string, unknown> | null = null;
    mockRepo.findOne.mockImplementation(async () => storedRow);
    mockRepo.save.mockImplementation(async (row) => {
      storedRow = row;
      return row;
    });
    mockRepo.update.mockImplementation(async (_criteria, patch) => {
      storedRow = { ...storedRow, ...patch };
      return { affected: 1 };
    });

    const resultSubject = new Subject<unknown>();
    let handlerStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      handlerStarted = resolve;
    });
    const firstHandler = {
      handle: jest.fn(() => {
        handlerStarted();
        return resultSubject;
      }),
    };
    const firstPromise = observe(
      guard.intercept(requestContext('booking-key-concurrent'), firstHandler as any),
    );
    await started;

    const secondHandler = { handle: jest.fn() };
    const secondPromise = observe(
      guard.intercept(
        requestContext('booking-key-concurrent'),
        secondHandler as any,
      ),
    );
    const responseData = { data: { id: 'booking-concurrent' } };
    resultSubject.next(responseData);
    resultSubject.complete();

    await expect(firstPromise).resolves.toEqual(responseData);
    await expect(secondPromise).resolves.toEqual(responseData);
    expect(firstHandler.handle).toHaveBeenCalledTimes(1);
    expect(secondHandler.handle).not.toHaveBeenCalled();
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  it('uses the database unique key to arbitrate simultaneous reservations', async () => {
    let storedRow: Record<string, unknown> | null = null;
    let initialLookups = 0;
    let releaseInitialLookups: () => void = () => undefined;
    const bothLookupsStarted = new Promise<void>((resolve) => {
      releaseInitialLookups = resolve;
    });
    mockRepo.findOne.mockImplementation(async () => {
      if (initialLookups < 2) {
        initialLookups += 1;
        if (initialLookups === 2) releaseInitialLookups();
        await bothLookupsStarted;
        return null;
      }
      return storedRow;
    });
    mockRepo.save.mockImplementation(async (row) => {
      if (storedRow) throw { code: '23505' };
      storedRow = row;
      return row;
    });
    mockRepo.update.mockImplementation(async (_criteria, patch) => {
      storedRow = { ...storedRow, ...patch };
      return { affected: 1 };
    });

    const responseData = { data: { id: 'booking-race' } };
    const firstHandler = { handle: jest.fn(() => of(responseData)) };
    const secondHandler = { handle: jest.fn(() => of(responseData)) };
    const [firstResult, secondResult] = await Promise.all([
      observe(
        guard.intercept(
          requestContext('booking-key-race'),
          firstHandler as any,
        ),
      ),
      observe(
        guard.intercept(
          requestContext('booking-key-race'),
          secondHandler as any,
        ),
      ),
    ]);

    expect(firstResult).toEqual(responseData);
    expect(secondResult).toEqual(responseData);
    expect(
      firstHandler.handle.mock.calls.length + secondHandler.handle.mock.calls.length,
    ).toBe(1);
    expect(mockRepo.save).toHaveBeenCalledTimes(2);
  });
});
