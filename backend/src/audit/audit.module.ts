import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

/**
 * BE-03 — Audit module.
 *
 * Owns the `audit_logs` table and exposes:
 *  - `AuditService` for other modules to record events into.
 *  - `AuditController` for admins to query the log.
 *
 * Other modules (auth, users, workspaces, contact) import the service
 * via `AuditModule` so we don't have to re-register the entity in every
 * feature module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
