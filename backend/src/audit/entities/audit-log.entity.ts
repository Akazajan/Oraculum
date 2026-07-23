import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * BE-03 — Audit logging for authentication and admin-sensitive actions.
 *
 * Each row represents one security-relevant action. Columns:
 *  - action: machine-readable event code (e.g. LOGIN_SUCCESS,
 *    LOGIN_FAILED, ROLE_CHANGED, WORKSPACE_DELETED, …).
 *  - outcome: SUCCESS | FAILURE so a single action type can carry
 *    both successful and failed attempts in the same table.
 *  - actorId / actorEmail: nullable for anonymous events (failed
 *    logins for unknown emails).
 *  - actorRole: snapshot of the actor's role at the time of the event.
 *  - resourceType / resourceId: the entity the action targeted.
 *  - ip / userAgent: forwarded from the originating request.
 *  - correlationId: ties the audit row to the request log (BE-08).
 *  - metadata: free-form jsonb for action-specific context.
 *
 * The composite index makes the admin filters efficient.
 */
export type AuditOutcome = 'SUCCESS' | 'FAILURE';

@Entity('audit_logs')
@Index(['action', 'createdAt'])
@Index(['actorId', 'createdAt'])
@Index(['resourceType', 'resourceId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 16, default: 'SUCCESS' })
  outcome: AuditOutcome;

  @Column({ type: 'uuid', nullable: true })
  actorId?: string | null;

  @Column({ type: 'varchar', length: 254, nullable: true })
  actorEmail?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  actorRole?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  resourceType?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resourceId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  userAgent?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  correlationId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
