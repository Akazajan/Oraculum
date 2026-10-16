import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { IdempotencyKey } from '../entities/idempotency-key.entity';
import { getCorrelationId } from '../context/correlation-context';

const STORED_RESPONSE_MARKER = '__idempotency';
const IN_PROGRESS_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;

interface StoredResponseMetadata {
  fingerprint: string;
  result?: unknown;
}

/**
 * BE-28/BE-29 — Idempotency interceptor for booking and payment endpoints.
 *
 * A database row reserves a user/key/endpoint before the handler runs. The
 * unique index prevents concurrent processes from claiming that key twice.
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
    const fingerprint = this.fingerprint(request.body);

    const keyPromise = idempotencyHeader
      ? Promise.resolve(idempotencyHeader)
      : this.generateKey(request, userId, endpoint);

    return new Observable<unknown>((subscriber) => {
      keyPromise
        .then(async (key) => {
          const normalizedKey = key.slice(0, 64);
          const reservation = await this.reserveOrReplay(
            normalizedKey,
            userId,
            endpoint,
            fingerprint,
          );

          if (!reservation.owner) {
            if (reservation.statusCode) {
              context.switchToHttp().getResponse().statusCode =
                reservation.statusCode;
            }
            subscriber.next(reservation.result);
            subscriber.complete();
            return;
          }

          next.handle().subscribe({
            next: async (data) => {
              try {
                await this.idempotencyRepo.update(
                  { key: normalizedKey, userId, endpoint },
                  {
                    response: this.wrapResponse(fingerprint, data),
                    statusCode: context.switchToHttp().getResponse().statusCode,
                    expiresAt: reservation.expiresAt,
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
            error: async (err: unknown) => {
              try {
                await this.idempotencyRepo.delete({
                  key: normalizedKey,
                  userId,
                  endpoint,
                });
              } catch (cleanupError) {
                this.logger.warn(
                  `Failed to release idempotency reservation: ${(cleanupError as Error).message} cid=${getCorrelationId()}`,
                );
              }
              subscriber.error(err);
            },
          });
        })
        .catch((err: unknown) => subscriber.error(err));
    });
  }

  private async reserveOrReplay(
    key: string,
    userId: string,
    endpoint: string,
    fingerprint: string,
  ): Promise<
    | { owner: true; expiresAt: Date }
    | { owner: false; result: unknown; statusCode: number | null }
  > {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    while (true) {
      const existing = await this.idempotencyRepo.findOne({
        where: { key, userId, endpoint },
      });

      if (existing && existing.expiresAt <= new Date()) {
        await this.idempotencyRepo.delete({ key, userId, endpoint });
        continue;
      }

      if (existing) {
        const stored = this.unwrapResponse(existing.response);
        if (stored.fingerprint && stored.fingerprint !== fingerprint) {
          throw new ConflictException(
            'Idempotency key was already used with a different request payload',
          );
        }
        if (stored.completed) {
          this.logger.log(`Idempotent replay for user=${userId}`);
          return {
            owner: false,
            result: stored.result,
            statusCode: existing.statusCode,
          };
        }

        const deadline = Date.now() + IN_PROGRESS_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          const current = await this.idempotencyRepo.findOne({
            where: { key, userId, endpoint },
          });
          if (!current || current.expiresAt <= new Date()) break;

          const currentResponse = this.unwrapResponse(current.response);
          if (
            currentResponse.fingerprint &&
            currentResponse.fingerprint !== fingerprint
          ) {
            throw new ConflictException(
              'Idempotency key was already used with a different request payload',
            );
          }
          if (currentResponse.completed) {
            return {
              owner: false,
              result: currentResponse.result,
              statusCode: current.statusCode,
            };
          }
        }

        const current = await this.idempotencyRepo.findOne({
          where: { key, userId, endpoint },
        });
        if (!current || current.expiresAt <= new Date()) continue;
        throw new ConflictException('A request with this idempotency key is still processing');
      }

      try {
        await this.idempotencyRepo.save(
          this.idempotencyRepo.create({
            key,
            userId,
            endpoint,
            response: this.wrapPendingResponse(fingerprint),
            statusCode: null,
            expiresAt,
          }),
        );
        return { owner: true, expiresAt };
      } catch (error) {
        if (!this.isUniqueConstraintViolation(error)) throw error;
        const collision = await this.idempotencyRepo.findOne({
          where: { key, userId },
        });
        if (collision?.endpoint !== endpoint) {
          throw new ConflictException(
            'Idempotency key is already in use for another endpoint',
          );
        }
      }
    }
  }

  private wrapPendingResponse(fingerprint: string): Record<string, unknown> {
    return { [STORED_RESPONSE_MARKER]: { fingerprint } };
  }

  private wrapResponse(
    fingerprint: string,
    result: unknown,
  ): Record<string, unknown> {
    return { [STORED_RESPONSE_MARKER]: { fingerprint, result } };
  }

  private unwrapResponse(response: Record<string, unknown> | null): {
    fingerprint?: string;
    result: unknown;
    completed: boolean;
  } {
    const metadata = response?.[STORED_RESPONSE_MARKER] as
      | StoredResponseMetadata
      | undefined;
    if (metadata && typeof metadata.fingerprint === 'string') {
      return {
        fingerprint: metadata.fingerprint,
        result: metadata.result,
        completed: Object.prototype.hasOwnProperty.call(metadata, 'result'),
      };
    }

    // Keep replay compatibility with responses stored before fingerprinting.
    return { result: response, completed: response !== null };
  }

  private fingerprint(body: unknown): string {
    const canonicalBody = JSON.stringify(this.sortObjectKeys(body ?? null));
    return createHash('sha256').update(canonicalBody).digest('hex');
  }

  private sortObjectKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sortObjectKeys(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.sortObjectKeys(item)]),
      );
    }
    return value;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private async generateKey(
    request: { body?: unknown },
    userId: string,
    endpoint: string,
  ): Promise<string> {
    const body = JSON.stringify(this.sortObjectKeys(request.body ?? null));
    const raw = `${userId}:${endpoint}:${body}`;
    return createHash('sha256').update(raw).digest('hex');
  }
}
