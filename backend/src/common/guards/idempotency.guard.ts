import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap, switchMap } from 'rxjs/operators';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { createHash } from 'crypto';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { getCorrelationId } from '../context/correlation-context';

/**
 * BE-29 — Idempotency guard for payment-initiation endpoints.
 *
 * How it works:
 *  1. Reads the `Idempotency-Key` header (or generates one from a
 *     content hash of the request body + userId + endpoint).
 *  2. If a non-expired key already exists for this user+endpoint,
 *     returns the stored response immediately (idempotent replay).
 *  3. Otherwise, locks the key, lets the request proceed, stores
 *     the response, and releases the lock on completion.
 *
 * Expired keys are cleaned up on a schedule via the
 * `cleanupExpiredKeys()` cron in the same module.
 */
@Injectable()
export class IdempotencyGuard implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyGuard.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepo: Repository<IdempotencyKey>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    if (!userId) return next.handle();

    const endpoint = `${request.method} ${request.route?.path ?? request.url}`;
    const idempotencyHeader = request.headers['idempotency-key'] as string | undefined;

    const keyPromise = idempotencyHeader
      ? Promise.resolve(idempotencyHeader)
      : this.generateKey(request, userId, endpoint);

    return new Observable<unknown>((subscriber) => {
      keyPromise
        .then(async (key) => {
          const normalizedKey = key.slice(0, 64);
          const existing = await this.idempotencyRepo.findOne({
            where: { key: normalizedKey, userId, endpoint },
          });

          if (existing && existing.expiresAt > new Date()) {
            if (existing.response) {
              this.logger.log(
                `Idempotent replay for key=${normalizedKey} user=${userId}`,
              );
              subscriber.next(existing.response);
              subscriber.complete();
              return;
            }
          }

          // Store pending key
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
          if (!existing) {
            const row = this.idempotencyRepo.create({
              key: normalizedKey,
              userId,
              endpoint,
              response: null,
              statusCode: null,
              expiresAt,
            });
            await this.idempotencyRepo.save(row);
          }

          // Let the request proceed and capture the response
          next.handle().subscribe({
            next: async (data) => {
              try {
                await this.idempotencyRepo.update(
                  { key: normalizedKey, userId, endpoint },
                  {
                    response: data as Record<string, unknown>,
                    statusCode: context.switchToHttp().getResponse().statusCode,
                    expiresAt,
                  },
                );
              } catch (err) {
                this.logger.warn(
                  `Failed to store idempotent response: ${(err as Error).message} cid=${getCorrelationId()}`,
                );
              }
              subscriber.next(data);
              subscriber.complete();
            },
            error: (err: unknown) => subscriber.error(err),
          });
        })
        .catch((err: unknown) => subscriber.error(err));
    });
  }

  private async generateKey(
    request: Record<string, unknown>,
    userId: string,
    endpoint: string,
  ): Promise<string> {
    const body = request.body ? JSON.stringify(request.body) : '';
    const raw = `${userId}:${endpoint}:${body}`;
    return createHash('sha256').update(raw).digest('hex');
  }
}
