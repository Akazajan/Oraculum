import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refreshToken.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);
  private readonly auditLogRetentionDays: number;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly configService: ConfigService,
  ) {
    this.auditLogRetentionDays = Number(
      this.configService.get<string>('AUDIT_LOG_RETENTION_DAYS') ?? '90',
    );
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleExpiredRefreshTokens(): Promise<void> {
    this.logger.log('Running expired refresh token cleanup…');

    const result = await this.refreshTokenRepository.delete({
      expiresAt: LessThan(new Date()),
    });

    this.logger.log(
      `Removed ${result.affected ?? 0} expired refresh token(s).`,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleStaleTemporaryUploads(): Promise<void> {
    this.logger.log('Running stale temporary upload cleanup…');

    const revoked = await this.refreshTokenRepository.delete({
      revoked: true,
      createdAt: LessThan(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      ),
    });

    this.logger.log(
      `Removed ${revoked.affected ?? 0} revoked refresh token(s) older than 7 days.`,
    );
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleOldAuditLogs(): Promise<void> {
    this.logger.log('Running old audit log cleanup…');

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.auditLogRetentionDays);

    const result = await this.auditLogRepository.delete({
      createdAt: LessThan(cutoff),
    });

    this.logger.log(
      `Removed ${result.affected ?? 0} audit log(s) older than ${this.auditLogRetentionDays} day(s).`,
    );
  }
}
