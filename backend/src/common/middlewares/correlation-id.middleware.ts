import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../context/correlation-context';

/**
 * BE-08 / BE-03 — Correlation-ID + request-context middleware.
 *
 * Every incoming request is wrapped in an AsyncLocalStorage context
 * that exposes a correlation ID, the client IP, and the user agent.
 * Downstream observers (HTTP logger, audit writer, exception filter,
 * validation pipe) read from the same context so they don't need
 * explicit parameters.
 *
 * The correlation ID is populated from the `x-correlation-id` header
 * when present (so upstream callers / load testers can stitch traces)
 * or from a fresh UUID v4 otherwise. The value is echoed in the
 * `x-correlation-id` response header.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-correlation-id');
    const correlationId =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : randomUUID();

    (req as Request & { correlationId?: string }).correlationId = correlationId;
    res.locals.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    const ip =
      this.extractClientIp(req) ||
      req.socket?.remoteAddress ||
      'unknown';
    const userAgent = req.get('user-agent') ?? 'unknown';

    runWithRequestContext(
      {
        correlationId,
        request: { ip, userAgent },
      },
      () => next(),
    );
  }

  private extractClientIp(req: Request): string | undefined {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim();
    }
    if (Array.isArray(xff) && xff.length > 0 && typeof xff[0] === 'string') {
      return xff[0].trim();
    }
    return req.ip;
  }
}
