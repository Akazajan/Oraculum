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
@Entity('refresh_tokens')
@Index(['token'], { unique: true })
@Index(['userId'])
@Index(['family'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'text' })
  token: string;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'boolean', default: false })
  revoked: boolean;

  /**
   * Session family — every token rotated from a given login carries
   * the same family. Replay of a revoked token revokes the family.
   */
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
    enum: ['logout', 'rotation', 'replay', 'password_reset', 'admin'],
    nullable: true,
  })
  revokedReason?: 'logout' | 'rotation' | 'replay' | 'password_reset' | 'admin';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  isUsable(now: Date = new Date()): boolean {
    if (this.revoked) return false;
    if (this.expiresAt && this.expiresAt < now) return false;
    return true;
  }
}
