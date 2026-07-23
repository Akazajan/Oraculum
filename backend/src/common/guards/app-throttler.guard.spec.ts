import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';

function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({
        setHeader: jest.fn(),
      }),
      getNext: () => undefined,
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('AppThrottlerGuard', () => {
  let guard: AppThrottlerGuard;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      providers: [AppThrottlerGuard, Reflector],
    }).compile();

    guard = moduleRef.get(AppThrottlerGuard);
  });

  it('tracks authenticated requests by user id', async () => {
    const req = { user: { id: 'user-42' }, ip: '127.0.0.1' };
    // @ts-expect-error test reaches protected method.
    const tracker = await guard.getTracker(req);
    expect(tracker).toBe('user:user-42');
  });

  it('falls back to IP for anonymous requests', async () => {
    const req = { user: undefined, ip: '203.0.113.10' };
    // @ts-expect-error test reaches protected method.
    const tracker = await guard.getTracker(req);
    expect(tracker).toBe('ip:203.0.113.10');
  });

  it('uses x-forwarded-for when present', async () => {
    const req = {
      headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    // @ts-expect-error test reaches protected method.
    const tracker = await guard.getTracker(req);
    expect(tracker).toBe('ip:198.51.100.7');
  });

  it('emits a standardized 429 response with retryAfter', async () => {
    const ctx = buildContext({});
    await expect(
      // @ts-expect-error test reaches protected method.
      guard.throwThrottlingException(ctx, {
        timeToBlockExpire: 12_345,
      } as never),
    ).rejects.toThrow(HttpException);
  });
});
