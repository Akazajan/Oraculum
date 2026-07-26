import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { IdempotencyGuard } from './guards/idempotency.guard';
import { IdempotencyCleanupService } from './services/idempotency-cleanup.service';

/**
 * BE-29 — Idempotency module.
 *
 * Registers the IdempotencyKey entity, exposes the IdempotencyGuard
 * for payment controllers, and provides a cron job that purges
 * expired keys.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([IdempotencyKey]),
    ScheduleModule.forRoot(),
  ],
  providers: [IdempotencyGuard, IdempotencyCleanupService],
  exports: [IdempotencyGuard, TypeOrmModule],
})
export class IdempotencyModule {}
