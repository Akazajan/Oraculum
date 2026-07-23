import { AsyncLocalStorage } from 'async_hooks';

/**
 * BE-08 / BE-03 — Request-scoped correlation + request context.
 *
 * The middleware that opens this ALS captures everything every
 * downstream observer might want without having to plumb it through
 * every function signature:
 *  - `correlationId` — used by the HTTP logger, audit writer,
 *    validation pipe and exception filter to stitch logs/errors/traces
 *    together end-to-end.
 *  - `request` — raw ip + user agent so audit and rate-limit messages
 *    can attribute actions to a network endpoint even when the user is
 *    anonymous.
 *  - `user` — the authenticated principal at the moment the ALS was
 *    entered. Note: this is captured at middleware entry time and so
 *    reflects the JWT-decoded identity when the request was issued,
 *    not later impersonation attempts.
 *
 * Falls back to sensible defaults when called outside of any tracked
 * request (queue workers, scheduled tasks, CLI scripts) so callers
 * can't accidentally leak `undefined`s into log lines.
 */
export interface CorrelationStore {
  correlationId: string;
  request: {
    ip: string;
    userAgent: string;
  };
  user?: {
    id?: string | null;
    email?: string | null;
    role?: string | null;
  };
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

const UNKNOWN_STORE: CorrelationStore = {
  correlationId: 'unknown',
  request: { ip: 'unknown', userAgent: 'unknown' },
};

export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? UNKNOWN_STORE.correlationId;
}

export function getRequestIp(): string {
  return correlationStorage.getStore()?.request?.ip ?? UNKNOWN_STORE.request.ip;
}

export function getUserAgent(): string {
  return correlationStorage.getStore()?.request?.userAgent ??
    UNKNOWN_STORE.request.userAgent;
}

export function getCurrentRequestUser(): CorrelationStore['user'] | undefined {
  return correlationStorage.getStore()?.user;
}

/**
 * Convenience wrapper to run a callback inside a correlation + request
 * context. The CorrelationIdMiddleware uses it for every incoming HTTP
 * request and tests reuse it to seed the ALS without a real request.
 */
export function runWithRequestContext<T>(
  store: CorrelationStore,
  fn: () => T,
): T {
  return correlationStorage.run(store, fn);
}
