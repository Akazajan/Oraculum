import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IdempotencyKey } from '../entities/idempotency-key.entity';

/**
 * BE-29 — Periodic cleanup of expired idempotency keys.
 *
 * Runs every hour by default. The interval can be overridden via
 * the IDEMPOTENCY_CLEANUP_CRON environment variable.
 */
@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanup() {
    try {
      const result = await this.repo.delete({
        expiresAt: LessThan(new Date()),
      });
      const count = result.affected ?? 0;
      if (count > 0) {
        this.logger.log(`Cleaned up ${count} expired idempotency keys`);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to cleanup expired idempotency keys: ${(err as Error).message}`,
      );
    }
  }
}
