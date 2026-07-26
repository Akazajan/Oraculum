import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExecutionContext } from '@nestjs/common';
import { IdempotencyGuard } from './idempotency.guard';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { of } from 'rxjs';

describe('IdempotencyGuard', () => {
  let guard: IdempotencyGuard;

  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
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

  it('skips for unauthenticated requests', async () => {
    const ctx = mockContext({ user: undefined });
    const handler = { handle: () => of({ data: 'ok' }) };
    const result$ = guard.intercept(ctx, handler as any);
    const result = await new Promise((resolve) =>
      result$.subscribe(resolve),
    );
    expect(result).toEqual({ data: 'ok' });
  });

  it('returns cached response on idempotent replay', async () => {
    const cachedResponse = { message: 'Payment initialized', data: { id: '1' } };
    mockRepo.findOne.mockResolvedValue({
      key: 'abc123',
      userId: 'user-1',
      endpoint: 'POST /payments/initialize',
      response: cachedResponse,
      expiresAt: new Date(Date.now() + 3600000),
    });

    const ctx = mockContext({
      headers: { 'idempotency-key': 'abc123' },
    });
    const nextSpy = { handle: jest.fn() };
    const result$ = guard.intercept(ctx, nextSpy as any);
    const result = await new Promise((resolve) =>
      result$.subscribe(resolve),
    );
    expect(result).toEqual(cachedResponse);
    expect(nextSpy.handle).not.toHaveBeenCalled();
  });

  it('lets request proceed for new idempotency key', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockImplementation((r) => r);
    mockRepo.save.mockResolvedValue({});

    const ctx = mockContext({
      headers: { 'idempotency-key': 'new-key-1' },
    });
    const responseData = { message: 'Payment initialized', data: { id: '2' } };
    const nextSpy = { handle: () => of(responseData) };
    const result$ = guard.intercept(ctx, nextSpy as any);
    const result = await new Promise((resolve) =>
      result$.subscribe(resolve),
    );
    expect(result).toEqual(responseData);
    expect(mockRepo.save).toHaveBeenCalled();
  });

  it('generates key from content hash when no header provided', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockImplementation((r) => r);
    mockRepo.save.mockResolvedValue({});

    const ctx = mockContext({ headers: {} });
    const nextSpy = { handle: () => of({ ok: true }) };
    guard.intercept(ctx, nextSpy as any);
    // Should call findOne to check for existing key
    expect(mockRepo.findOne).toHaveBeenCalled();
  });
});
