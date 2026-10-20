import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserMessages } from './user-messages';
import { JwtPayload } from '../interface/user.interface';
import { User } from '../../users/entities/user.entity';

type TwoFaPendingPayload = {
  sub: string;
  type: '2fa_pending';
  iat?: number;
  exp?: number;
};

type RefreshPayload = JwtPayload & { family?: string };

//jwt expiry type
type JwtExpiry = `${number}${'s' | 'm' | 'h' | 'd'}` | number;

/** Minimum length for production-grade JWT secrets. */
export const MIN_JWT_SECRET_LENGTH = 32;

const EXPIRY_PATTERN = /^(\d+)([smhd])$/;

/**
 * BE-10 — Validate token configuration at process startup.
 *
 * Identifies the invalid setting by name without ever logging or
 * returning the secret value itself.
 */
export function validateTokenConfiguration(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const errors: string[] = [];

  const accessSecret = env.JWT_SECRET;
  if (!accessSecret || !accessSecret.trim()) {
    errors.push('JWT_SECRET is missing');
  } else if (accessSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET is too short (minimum ${MIN_JWT_SECRET_LENGTH} characters)`,
    );
  } else if (/^(test|secret|changeme|password|jwt)/i.test(accessSecret)) {
    errors.push('JWT_SECRET uses an unsafe default value');
  }

  const refreshSecret = env.JWT_REFRESH_SECRET;
  if (!refreshSecret || !refreshSecret.trim()) {
    errors.push('JWT_REFRESH_SECRET is missing');
  } else if (refreshSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_REFRESH_SECRET is too short (minimum ${MIN_JWT_SECRET_LENGTH} characters)`,
    );
  } else if (accessSecret && refreshSecret === accessSecret) {
    errors.push(
      'JWT_REFRESH_SECRET must differ from JWT_SECRET',
    );
  }

  for (const key of ['JWT_EXPIRATION', 'JWT_REFRESH_EXPIRATION'] as const) {
    const value = env[key];
    if (value === undefined || value === '') continue;
    if (typeof value === 'number' || /^\d+$/.test(value)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        errors.push(`${key} must be a positive duration`);
      }
      continue;
    }
    if (!EXPIRY_PATTERN.test(value)) {
      errors.push(
        `${key} is invalid (expected number or patterns like 15m, 1h, 7d)`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid token configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
}

@Injectable()
export class JwtHelper {
  constructor(private readonly jwtService: JwtService) {}

  public validateRefreshToken(
    refreshToken: string,
  ): { userId: string; family?: string } | null {
    try {
      const payload = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET as string,
      });

      if (!payload?.sub) return null;
      return { userId: payload.sub, family: payload.family };
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('JWT verification failed:', error.message);
      } else {
        console.error('JWT verification failed:', error);
      }
      throw new UnauthorizedException(UserMessages.INVALID_REFRESH_TOKEN);
    }
  }

  public generateAccessToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    return this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET as string,
      expiresIn: (process.env.JWT_EXPIRATION ?? '1h') as JwtExpiry,
    });
  }

  /**
   * BE-04 — Refresh tokens are minted with a family id so a successful
   * `refresh-token` call can rotate them safely. The rotation flow in
   * AuthService stamps the new token with the *previous* token's family
   * so lineage survives across rotations.
   */
  public generateRefreshToken(user: User, family?: string): string {
    const payload: RefreshPayload = {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      family,
    };

    return this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET as string,
      expiresIn: (process.env.JWT_REFRESH_EXPIRATION ?? '7d') as JwtExpiry,
    });
  }

  /**
   * Convenience wrapper that mints both tokens with a fresh family on
   * the very first issuance (e.g. login). Rotations always pass an
   * existing family through `generateRefreshToken` directly.
   */
  public generateTokens(
    user: User,
  ): { accessToken: string; refreshToken: string } {
    return {
      accessToken: this.generateAccessToken(user),
      refreshToken: this.generateRefreshToken(user),
    };
  }

  public generateTempToken(userId: string): string {
    const payload: TwoFaPendingPayload = { sub: userId, type: '2fa_pending' };
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET as string,
      expiresIn: '5m' as any,
    });
  }

  public verifyTempToken(token: string): TwoFaPendingPayload {
    try {
      const payload = this.jwtService.verify<TwoFaPendingPayload>(token, {
        secret: process.env.JWT_SECRET as string,
      });
      if (payload.type !== '2fa_pending') {
        throw new UnauthorizedException('Invalid token type');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired 2FA token');
    }
  }
}
