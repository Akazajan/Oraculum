import { Logger } from '@nestjs/common';

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Must be >= 1. */
  maxAttempts: number;
  /** Base delay in milliseconds between attempts. */
  baseDelayMs: number;
  /** Cap for the delay between attempts. */
  maxDelayMs?: number;
  /** Optional jitter factor (0..1) applied to each delay. Default 0.25. */
  jitter?: number;
  /** Predicate identifying errors that should be retried. */
  isRetryable: (error: unknown) => boolean;
  /** Optional callback so callers can log/propagate attempts. */
  onRetry?: (error: unknown, attempt: number, nextDelayMs: number) => void;
}

/**
 * Run an async operation and retry it with exponential backoff when it fails
 * with a transient (retryable) error. Non-retryable errors are thrown
 * immediately.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitter = 0.25,
    isRetryable,
    onRetry,
  } = options;

  if (maxAttempts < 1) {
    throw new Error('withRetry: maxAttempts must be >= 1');
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      const shouldRetry = attempt < maxAttempts && isRetryable(error);
      if (!shouldRetry) {
        throw error;
      }

      const exp = baseDelayMs * 2 ** (attempt - 1);
      const capped = maxDelayMs ? Math.min(exp, maxDelayMs) : exp;
      const jitterAmount = capped * jitter * (Math.random() * 2 - 1);
      const delayMs = Math.max(0, Math.round(capped + jitterAmount));

      if (onRetry) {
        onRetry(error, attempt, delayMs);
      } else {
        Logger.log(
          `withRetry: attempt ${attempt} failed, retrying in ${delayMs}ms`,
          'withRetry',
        );
      }

      await sleep(delayMs);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true when the thrown error is a TypeORM optimistic-lock conflict.
 * This is used to safely retry concurrent workspace updates.
 */
export function isOptimisticLockError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const anyErr = error as { name?: string; constructor?: { name?: string } };
  const name = anyErr.name ?? anyErr.constructor?.name;
  return name === 'OptimisticLockVersionMismatchError';
}
