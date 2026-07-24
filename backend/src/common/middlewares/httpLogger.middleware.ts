import { Request, Response, NextFunction } from 'express';
import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { getCorrelationId } from '../context/correlation-context';

/**
 * HTTP access log middleware (extended for BE-08).
 *
 * Each line is prefixed with `[cid=<correlationId>]` when a correlation
 * ID is available either on the request (set by `CorrelationIdMiddleware`)
 * or via the AsyncLocalStorage context. This makes it trivial to grep
 * a single user request across the runtime log.
 */
@Injectable()
export class HttpLogger implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const startAt = process.hrtime();
    const { ip, method, originalUrl } = request;
    const userAgent = request.get('user-agent') || '';

    response.on('finish', () => {
      const logger = new Logger('HttpLogger');
      const { statusCode } = response;
      const contentLength = response.get('content-length');
      const diff = process.hrtime(startAt);
      const responseTime = diff[0] * 1e3 + diff[1] * 1e-6;

      const fromReq = (request as Request & { correlationId?: string })
        .correlationId;
      const correlationId = fromReq ?? getCorrelationId();

      logger.log(
        `[cid=${correlationId}] ${method} ${originalUrl} ${statusCode} ${responseTime}ms ${contentLength} - ${userAgent} ${ip}`,
      );
    });

    next();
  }
}
