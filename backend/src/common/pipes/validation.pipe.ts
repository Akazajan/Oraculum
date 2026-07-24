import { ValidationError, ValidationPipe } from '@nestjs/common';
import { getCorrelationId } from '../context/correlation-context';

/**
 * BE-01 — Centralized validation pipe.
 *
 * Extends Nest's stock `ValidationPipe` so every controller benefits
 * from the same:
 *  - whitelist enforcement (strips unknown fields)
 *  - non-whitelisted rejection (returns 400 on unknown fields)
 *  - implicit type coercion from class-transformer
 *  - consistent error payload shape (statusCode / error / message /
 *    fields / correlationId) – never the raw Nest default which mixes
 *    shapes depending on whether one or several fields failed.
 *
 * The error factory reads the correlation ID from the
 * AsyncLocalStorage context opened by `CorrelationIdMiddleware` so
 * every validator failure is traceable end-to-end.
 */
export class CentralizedValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      exceptionFactory: (errors: ValidationError[]) =>
        buildValidationException(errors),
    });
  }
}

export function buildValidationException(
  errors: ValidationError[],
): import('@nestjs/common').BadRequestException {
  const fields = errors.map((err) => ({
    field: err.property,
    constraints: Object.values(err.constraints ?? {}),
    children: err.children?.length
      ? err.children.map((c) => ({
          field: `${err.property}.${c.property}`,
          constraints: Object.values(c.constraints ?? {}),
        }))
      : undefined,
  }));

  return new BadRequestExceptionWithCorrelation({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    fields,
    correlationId: getCorrelationId(),
  });
}

import { BadRequestException } from '@nestjs/common';

class BadRequestExceptionWithCorrelation extends BadRequestException {
  constructor(payload: Record<string, unknown>) {
    super(payload);
  }
}
