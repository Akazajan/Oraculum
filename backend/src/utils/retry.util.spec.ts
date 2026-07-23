import { isOptimisticLockError, sleep, withRetry } from './retry.util';

class OptimisticLockError extends Error {
  constructor() {
    super('version mismatch');
    this.name = 'OptimisticLockVersionMismatchError';
  }
}

describe('withRetry', () => {
  it('returns the result on a successful first attempt', async () => {
    const op = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(op, {
      maxAttempts: 3,
      baseDelayMs: 1,
      isRetryable: () => true,
    });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable errors up to maxAttempts', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error('econnreset'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(op, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      isRetryable: () => true,
    });
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after maxAttempts is exhausted', async () => {
    const op = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      withRetry(op, {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: () => true,
      }),
    ).rejects.toThrow('boom');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry when isRetryable returns false', async () => {
    const op = jest.fn().mockRejectedValue(new Error('permanent'));
    await expect(
      withRetry(op, {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: () => false,
      }),
    ).rejects.toThrow('permanent');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('invokes onRetry for each scheduled retry', async () => {
    const onRetry = jest.fn();
    const op = jest
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockResolvedValueOnce('ok');
    await withRetry(op, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      isRetryable: () => true,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('isOptimisticLockError', () => {
  it('returns true for OptimisticLockVersionMismatchError', () => {
    expect(isOptimisticLockError(new OptimisticLockError())).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isOptimisticLockError(new Error('boom'))).toBe(false);
    expect(isOptimisticLockError('string')).toBe(false);
    expect(isOptimisticLockError(null)).toBe(false);
  });
});

describe('sleep', () => {
  it('resolves after roughly the requested duration', async () => {
    const start = Date.now();
    await sleep(20);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });
});
