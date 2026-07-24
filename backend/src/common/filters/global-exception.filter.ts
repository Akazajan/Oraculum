import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getCorrelationId } from '../context/correlation-context';

/**
 * BE-08 — Global exception filter.
 *
 * Normalises every error response into a stable structure so clients
 * (and operators) can rely on a single shape:
 *
 *   {
 *     statusCode: number,
 *     error: string,
 *     message: string | string[],
 *     correlationId: string,
 *     timestamp: string,
 *     path: string
 *   }
 *
 * The correlation ID is read from the AsyncLocalStorage context opened
 * by `CorrelationIdMiddleware`, so service-level throws are still
 * connected to the originating request.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const correlationId =
      request.correlationId ?? getCorrelationId() ?? 'unknown';
    const requestPath = request.originalUrl ?? request.url;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        message =
          (obj.message as string | string[] | undefined) ?? exception.message;
        error = (obj.error as string | undefined) ?? exception.name;
      } else {
        message = exception.message;
      }
      // Override default error label with the canonical HTTP reason so
      // payloads like { error: 'Bad Request' } stay consistent.
      if (!error || error === 'Error') {
        error = exception.name.replace('Exception', '');
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error on ${request.method} ${requestPath} [cid=${correlationId}]: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(
        `Unhandled throw on ${request.method} ${requestPath} [cid=${correlationId}]: ${String(exception)}`,
      );
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${requestPath} ${status} [cid=${correlationId}]`,
      );
    } else {
      this.logger.warn(
        `${request.method} ${requestPath} ${status} [cid=${correlationId}]`,
      );
    }

    if (!response.headersSent && typeof response.setHeader === 'function') {
      response.setHeader('x-correlation-id', correlationId);
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      correlationId,
      timestamp: new Date().toISOString(),
      path: requestPath,
    });
  }
}
