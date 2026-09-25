import { getCurrentRequestUser } from '../context/correlation-context';

/**
 * Snapshot the actor from the AsyncLocalStorage context opened by the
 * correlation-id middleware so audit rows recorded during background
 * flows (e.g. admin-issued register-admin) automatically pick up the
 * caller's identity, role, and contact details.
 *
 * Fields are nullable and default to `null` when no user is attached to
 * the context (anonymous requests, queue workers, scheduled tasks),
 * matching the `AuditActor` contract consumed by `AuditService`.
 */
export function getCurrentActorFromAls(): {
  id: string | null;
  email: string | null;
  role: string | null;
} {
  const current = getCurrentRequestUser();
  return {
    id: current?.id ?? null,
    email: current?.email ?? null,
    role: current?.role ?? null,
  };
}
