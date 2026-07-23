import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditOutcome } from './entities/audit-log.entity';
import {
  getCorrelationId,
  getCurrentRequestUser,
  getRequestIp,
  getUserAgent,
} from '../common/context/correlation-context';

/**
 * Public list of audit action codes. Centralised so every contributor
 * picks from the same vocabulary and reporting endpoints stay
 * predictable. Any string is accepted at write time, but adding a new
 * literal here is the supported way to introduce a new event.
 */
export const AuditAction = {
  // Auth
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  REGISTER: 'REGISTER',
  REGISTER_ADMIN: 'REGISTER_ADMIN',
  PASSWORD_RESET_REQUEST: 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET_SUCCESS: 'PASSWORD_RESET_SUCCESS',
  PASSWORD_RESET_FAILED: 'PASSWORD_RESET_FAILED',
  OTP_VERIFIED: 'OTP_VERIFIED',
  OTP_FAILED: 'OTP_FAILED',
  TOTP_LOGIN_SUCCESS: 'TOTP_LOGIN_SUCCESS',
  TOTP_LOGIN_FAILED: 'TOTP_LOGIN_FAILED',
  TOTP_ENABLED: 'TOTP_ENABLED',
  TOTP_DISABLED: 'TOTP_DISABLED',
  // Users / Roles
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_RESTORED: 'USER_RESTORED',
  ROLE_CHANGED: 'ROLE_CHANGED',
  MEMBERSHIP_STATUS_CHANGED: 'MEMBERSHIP_STATUS_CHANGED',
  PROFILE_PICTURE_UPDATED: 'PROFILE_PICTURE_UPDATED',
  PROFILE_PICTURE_FAILED: 'PROFILE_PICTURE_FAILED',
  // Workspaces
  WORKSPACE_CREATED: 'WORKSPACE_CREATED',
  WORKSPACE_UPDATED: 'WORKSPACE_UPDATED',
  WORKSPACE_DELETED: 'WORKSPACE_DELETED',
  WORKSPACE_RESTORED: 'WORKSPACE_RESTORED',
  // Contact
  CONTACT_SUBMITTED: 'CONTACT_SUBMITTED',
  CONTACT_MARKED_READ: 'CONTACT_MARKED_READ',
  CONTACT_DELETED: 'CONTACT_DELETED',
  CONTACT_RESTORED: 'CONTACT_RESTORED',
} as const;

export type AuditActionCode =
  (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditActor {
  id?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface AuditEntry {
  action: AuditActionCode | string;
  outcome?: AuditOutcome;
  actor?: AuditActor;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * BE-03 — Centralised audit writer.
 *
 * Behaviour:
 *  - `log()` never throws: audit failures must never break the
 *    user-facing request. Errors are logged at WARN so operators
 *    notice them in production logs without crashing the response.
 *  - The correlation ID, client IP, and user agent are taken from the
 *    AsyncLocalStorage context established by the correlation-id
 *    middleware, so callers do not have to forward them explicitly.
 *  - The repository is injected via @Optional() to keep unit tests
 *    easy: a test that does not care about persistence can pass
 *    `undefined` and only verify the side effects.
 */
@Injectable()
export class AuditService {
  constructor(
    @Optional()
    @InjectRepository(AuditLog)
    private readonly auditRepository?: Repository<AuditLog>,
  ) {}

  /**
   * Resolve the actor from an explicit parameter, else from the ALS,
   * else undefined so anonymous events (failed login for unknown
   * email) still record the IP / correlation ID.
   */
  private resolveActor(explicit?: AuditActor): AuditActor | undefined {
    if (explicit) return explicit;
    const current = getCurrentRequestUser();
    if (!current) return undefined;
    return {
      id: current.id,
      email: current.email,
      role: current.role,
    };
  }

  async log(entry: AuditEntry): Promise<AuditLog | null> {
    const correlationId = getCorrelationId();
    const actor = this.resolveActor(entry.actor);

    const row: Partial<AuditLog> = {
      action: entry.action,
      outcome: entry.outcome ?? 'SUCCESS',
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      ip: getRequestIp(),
      userAgent: getUserAgent(),
      correlationId,
      metadata: entry.metadata ?? null,
    };

    if (!this.auditRepository) {
      // Logger fallback used by tests / when the repository is not wired.
      // eslint-disable-next-line no-console
      console.warn(
        `[audit] ${row.action} ${row.outcome} actor=${row.actorEmail ?? 'anon'} resource=${row.resourceType ?? '-'}/${row.resourceId ?? '-'} cid=${correlationId}`,
      );
      return null;
    }

    try {
      const created = this.auditRepository.create(row);
      return await this.auditRepository.save(created);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[audit] failed to persist ${row.action} (cid=${correlationId}): ${
          (err as Error)?.message ?? err
        }`,
      );
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Convenience helpers used by service code. They keep every
  // caller-side usage declarative and signature-stable.
  // ──────────────────────────────────────────────────────────
  authSuccess(action: AuditActionCode, actor: AuditActor) {
    return this.log({ action, outcome: 'SUCCESS', actor });
  }

  authFailure(
    action: AuditActionCode,
    attemptedEmail: string | null,
    metadata?: Record<string, unknown>,
  ) {
    return this.log({
      action,
      outcome: 'FAILURE',
      actor: { email: attemptedEmail },
      metadata,
    });
  }

  adminAction(
    action: AuditActionCode,
    actor: AuditActor,
    resourceType: string,
    resourceId: string | null,
    metadata?: Record<string, unknown>,
  ) {
    return this.log({
      action,
      outcome: 'SUCCESS',
      actor,
      resourceType,
      resourceId,
      metadata,
    });
  }
}
