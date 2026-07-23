import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerLimitDetail,
  ThrottlerRequest,
} from '@nestjs/throttler';
import { Request, Response } from 'express';

/**
 * Application-wide throttler guard (BE-07).
 *
 * Tracking:
 *  - Authenticated requests are tracked by the user id so limits aren't
 *    shared across users behind the same NAT / proxy.
 *  - Anonymous / public requests fall back to the request IP.
 *
 * Different thresholds (BE-07 acceptance):
 *  - Two global named tiers are registered: `default-anon` (stricter,
 *    for anon traffic) and `default-auth` (looser, for auth traffic).
 *  - `handleRequest` checks the tier name and silently skips enforcement
 *    of the wrong one for the current request. Net effect: auth users
 *    only burn `default-auth` budget; anon users only burn `default-anon`.
 *
 * 429 response: structured payload plus `Retry-After` header in seconds.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /** @inheritdoc */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const userId = this.extractUserId(req);
    if (userId !== undefined && userId !== null) {
      return `user:${userId}`;
    }
    return `ip:${this.extractClientIp(req)}`;
  }

  /** @inheritdoc */
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const isAuthenticated = !!requestProps.context.switchToHttp().getRequest()
      ?.user?.id;
    const tierName = requestProps.throttler?.name;
    const skipForAuth = isAuthenticated && tierName === 'default-anon';
    const skipForAnon = !isAuthenticated && tierName === 'default-auth';
    if (skipForAuth || skipForAnon) {
      return true;
    }
    return super.handleRequest(requestProps);
  }

  /**
   * Standardized 429 response (`Retry-After` in seconds + structured body).
   * Return type matches the parent Promise<void>.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfter = Math.max(
      1,
      Math.ceil(throttlerLimitDetail.timeToBlockExpire ?? 60),
    );
    const res = context.switchToHttp().getResponse<Response>();
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', String(retryAfter));
    }
    throw new HttpException(
      {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Too many requests, please try again in ${retryAfter} seconds.`,
        retryAfter,
      },
      429,
    );
  }

  private extractUserId(
    req: Record<string, unknown>,
  ): string | number | undefined {
    const user = req['user'] as { id?: string | number } | undefined;
    if (!user) return undefined;
    if (user.id === undefined || user.id === null) return undefined;
    return user.id;
  }

  private extractClientIp(req: Record<string, unknown>): string {
    const requestLike = req as Partial<Request> & {
      headers?: Record<string, unknown>;
      socket?: { remoteAddress?: string };
    };
    const xff = requestLike.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
    if (Array.isArray(xff) && xff.length > 0 && typeof xff[0] === 'string') {
      return xff[0].trim();
    }
    return requestLike.ip ?? requestLike.socket?.remoteAddress ?? 'unknown';
  }
}
