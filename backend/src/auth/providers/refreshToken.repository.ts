import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RefreshToken } from '../entities/refreshToken.entity';
import { User } from '../../users/entities/user.entity';

export type RevokeReason =
  | 'logout'
  | 'rotation'
  | 'replay'
  | 'password_reset'
  | 'admin';

/**
 * BE-04 / BE-08 / BE-09 — Refresh-token rotation, logout revoke, replay detection.
 */
@Injectable()
export class RefreshTokenRepositoryOperations {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
  ) {}

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
    reason: RevokeReason = 'logout',
  ): Promise<void> {
    await this.repo.update(
      { token, revoked: false },
      { revoked: true, revokedReason: reason },
    );
  }

  /** Alias used by older auth.service call sites. */
  async revokeRefreshToken(
    stored: RefreshToken,
    reason: RevokeReason = 'logout',
  ): Promise<void> {
    await this.repo.update(
      { id: stored.id },
      { revoked: true, revokedReason: reason },
    );
  }

  async findToken(token: string): Promise<RefreshToken | null> {
    return this.repo.findOne({ where: { token } });
  }

  /** Look up by user + token (legacy signature). */
  async findRefreshToken(
    user: User,
    token: string,
  ): Promise<RefreshToken | null> {
    return this.repo.findOne({ where: { token, userId: user.id } });
  }

  async findValidToken(token: string): Promise<RefreshToken | null> {
    const rt = await this.repo.findOne({ where: { token } });
    if (!rt || !rt.isUsable()) return null;
    return rt;
  }

  private computeExpiryFromEnv(): Date | undefined {
    const raw = process.env.JWT_REFRESH_EXPIRATION_MS;
    const ms = raw ? Number(raw) : 7 * 24 * 60 * 60 * 1000;
    if (Number.isFinite(ms) && ms > 0) {
      return new Date(Date.now() + ms);
    }
    return undefined;
  }

  async revokeAllRefreshTokens(
    userId: string,
    reason: RevokeReason = 'logout',
  ): Promise<void> {
    await this.repo.update(
      { userId, revoked: false },
      { revoked: true, revokedReason: reason },
    );
  }

  async revokeFamily(
    family: string,
    reason: RevokeReason = 'replay',
  ): Promise<void> {
    if (!family) return;
    await this.repo.update(
      { family, revoked: false },
      { revoked: true, revokedReason: reason },
    );
  }
}
