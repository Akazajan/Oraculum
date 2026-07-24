import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  VersionColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { WorkspaceType } from '../enums/workspace-type.enum';

/**
 * BE-14 — Workspaces support soft-delete via TypeORM's
 * `@DeleteDateColumn`. By default, every query excludes rows with a
 * non-null `deletedAt`, which keeps the public listing endpoint clean
 * while preserving the row for audit / restore operations.
 *
 * `isActive` is kept for legacy callers / the public availability check
 * but is no longer the source of truth for "is the workspace gone".
 *
 * `Bookings` and `Payments` reference workspaces via FK and so remain
 * referentially intact after soft-delete; the admin restore endpoint
 * sets `deletedAt` back to null without collateral damage.
 */
@Entity('workspaces')
@Index(['deletedAt'])
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: WorkspaceType })
  type: WorkspaceType;

  @Column({ type: 'int', default: 1 })
  totalSeats: number;

  @Column({ type: 'int', default: 1 })
  availableSeats: number;

  // Optimistic concurrency token: TypeORM increments this on every save.
  // Concurrent updates cause OptimisticLockVersionMismatchError so callers
  // can retry or surface the conflict to users safely.
  @VersionColumn()
  version: number;

  // Stored in kobo (smallest currency unit). e.g. ₦5000/hr = 500000 kobo
  @Column({ type: 'bigint' })
  hourlyRate: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'simple-array', nullable: true })
  amenities: string[];

  @Column({ type: 'simple-array', nullable: true })
  images: string[];

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * BE-14 — TypeORM-recognised soft-delete column. NULL = active row,
   * non-NULL = row soft-deleted at the given timestamp. Indexed so
   * "show me every non-deleted workspace" stays fast even when the
   * table grows large.
   */
  @DeleteDateColumn()
  deletedAt: Date | null;
}
