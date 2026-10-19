import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * BE-04 — Refresh-token rotation.
 *
 * The `family` column links every refresh token minted for the same
 * login session. When a refresh token is rotated, the new token stays
 * in the same family. If a revoked token is presented a second time
 * (replay detection), every token in that family is revoked to force
 * the user to re-authenticate elsewhere as well.
 */
// Maps this class to the "refresh_tokens" table
@Entity('refresh_tokens')
// Unique index: no two rows can hold the same token string, and lookups
// by token (the main operation when refreshing) are fast
@Index(['token'], { unique: true })
// Speeds up finding or revoking all tokens belonging to a user
// (e.g. on logout-everywhere or password reset)
@Index(['userId'])
// Speeds up revoking an entire family when a replay is detected
@Index(['family'])
export class RefreshToken {
  // Auto-generated UUID primary key
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Explicit foreign key column, so queries can filter by userId
  // without loading the User relation
  @Column('uuid')
  userId: string;

  // Many refresh tokens belong to one user (a user can be logged in on
  // several devices). onDelete: 'CASCADE' removes a user's tokens when the
  // user is deleted
  @ManyToOne(() => User, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  user: User;

  // The refresh token value. Stored as text; consider storing a hash instead
  // of the raw token so a database leak doesn't expose usable tokens
  @Column({ type: 'text' })
  token: string;

  // When the token stops being valid; timezone-aware timestamp.
  // Optional, and isUsable() treats a missing value as "no expiry"
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  // Whether the token has been invalidated (rotated, logged out, etc.).
  // Revoked tokens are kept rather than deleted, so replays can be detected
  @Column({ type: 'boolean', default: false })
  revoked: boolean;

  /**
   * Session family — every token rotated from a given login carries
   * the same family. Replay of a revoked token revokes the family.
   */
  // Nullable so rows created before this column existed remain valid
  @Column({ type: 'uuid', nullable: true })
  family?: string;

  /**
   * Set when revoked — distinguishes "rotated normally" from
   * "killed because a sibling token was replayed" for audit logs.
   *
   * The column name is pinned to snake_case so the Postgres enum
   * type created by TypeORM is deterministic regardless of any
   * future namingStrategy change. The migration file
   * `1711900000000-AddFamilyAndRevokedReasonToRefreshToken.ts`
   * mirrors this exact identifier.
   */
  @Column({
    name: 'revoked_reason',
    type: 'enum',
    // Allowed reasons: user logged out, normal rotation, replay of an
    // already-revoked token, password reset, or manual admin action
    enum: ['logout', 'rotation', 'replay', 'password_reset', 'admin'],
    // Null while the token is still active
    nullable: true,
  })
  revokedReason?: 'logout' | 'rotation' | 'replay' | 'password_reset' | 'admin';

  // Set automatically when the row is inserted
  @CreateDateColumn()
  createdAt: Date;

  // Updated automatically on every save (e.g. when the token is revoked)
  @UpdateDateColumn()
  updatedAt: Date;

  // Returns true if the token can still be exchanged for a new one.
  // `now` is injectable so the method is easy to unit test
  isUsable(now: Date = new Date()): boolean {
    // A revoked token is never usable
    if (this.revoked) return false;
    // Expired tokens are rejected; no expiresAt means no expiry
    if (this.expiresAt && this.expiresAt < now) return false;
    return true;
  }
}