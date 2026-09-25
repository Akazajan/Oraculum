import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
@Catch()
export class AppService implements ExceptionFilter {
  private readonly logger = new Logger(AppService.name);

  getHello(): string {
    return 'Hello World!';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const correlationId = request.correlationId ?? 'unknown';
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
        message = (obj.message as string | string[] | undefined) ?? exception.message;
        error = (obj.error as string | undefined) ?? exception.name;
      } else {
        message = exception.message;
      }
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
