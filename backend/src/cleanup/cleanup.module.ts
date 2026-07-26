import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleanupService } from './cleanup.service';
import { RefreshToken } from '../auth/entities/refreshToken.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RefreshToken, AuditLog])],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}
