import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RefreshToken } from '../entities/refreshToken.entity';
import { User } from '../../users/entities/user.entity';

/**
 * BE-04 — Refresh-token rotation & family-based revocation.
 *
 * A "family" is a UUID assigned to the first refresh token issued at
 * login. Every rotation of that token inherits the same family, so
 * the lineage of a single login session is identifiable in the DB.
 * If a revoked token is presented again (replay attempt), the entire
 * family is revoked — every device that authenticated through the
 * same login is logged out.
 */
@Injectable()
export class RefreshTokenRepositoryOperations {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
  ) {}

  /**
   * Persist a refresh token for a user. A fresh family is minted when
   * none is supplied (e.g. on initial login). On rotation, the caller
   * reuses the previous token's family so lineage stays intact.
   */
  async saveRefreshToken(
    user: User,
    token: string,
    family?: string,
  ): Promise<RefreshToken> {
    const expiresAt = this.computeExpiryFromEnv();

    const rt = this.repo.create({
      userId: user.id,
      token,
      expiresAt,
      revoked: false,
      family: family ?? randomUUID(),
    });

    return this.repo.save(rt);
  }

  async revokeToken(
    token: string,
    reason: 'logout' | 'rotation' | 'replay' | 'password_reset' | 'admin' = 'logout',
  ): Promise<void> {
    await this.repo.update({ token }, { revoked: true, revokedReason: reason });
  }

  /**
   * Look up a refresh token regardless of revoked state.
   * Used by the rotation flow to distinguish "valid" from "replayed".
   */
  async findToken(token: string): Promise<RefreshToken | null> {
    return this.repo.findOne({ where: { token } });
  }

  /**
   * Look up a refresh token, but only consider it usable if it is
   * neither revoked nor expired.
   */
  async findValidToken(token: string): Promise<RefreshToken | null> {
    const rt = await this.repo.findOne({ where: { token } });
    if (!rt) return null;
    if (!rt.isUsable()) return null;
    return rt;
  }

  private computeExpiryFromEnv(): Date | undefined {
    // supports ms number or '7d' etc? We'll keep ms for now.
    const raw = process.env.JWT_REFRESH_EXPIRATION;
    if (!raw) return undefined;

    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) {
      return new Date(Date.now() + ms);
    }
    return undefined;
  }

  /**
   * Revoke every refresh token belonging to a user. Used at logout,
   * password reset, and admin-driven session termination.
   */
  async revokeAllRefreshTokens(
    userId: string,
    reason: 'logout' | 'rotation' | 'replay' | 'password_reset' | 'admin' = 'logout',
  ): Promise<void> {
    await this.repo.update(
      { userId, revoked: false },
      { revoked: true, revokedReason: reason },
    );
  }

  /**
   * Revoke every refresh token that shares the given family id.
   * Triggered when a revoked token is replayed — best-effort to
   * evict any sibling a stolen token could have rotated into.
   */
  async revokeFamily(
    family: string,
    reason: 'replay' | 'logout' | 'rotation' | 'password_reset' | 'admin' = 'replay',
  ): Promise<void> {
    if (!family) return;
    await this.repo.update(
      { family, revoked: false },
      { revoked: true, revokedReason: reason },
    );
  }
}
