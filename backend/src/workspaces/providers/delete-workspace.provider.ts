import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';
import { FindWorkspaceByIdProvider } from './find-workspace-by-id.provider';
import {
  isOptimisticLockError,
  withRetry,
} from '../../utils/retry.util';
import { AuditAction, AuditService } from '../../audit/audit.service';
import { CacheInvalidationProvider } from '../../common/providers/cache-invalidation.provider';

/**
 * BE-14 — Soft-deletes a workspace via TypeORM's `repository.softDelete`
 * which writes the `@DeleteDateColumn` rather than removing the row.
 *
 * `isActive` is also flipped to false so any downstream code still
 * keying off that flag (e.g. the public availability check) treats the
 * workspace as gone. The admin restore endpoint sets both back.
 *
 * BE-03 — emits an audit event so the deletion is traceable end-to-
 * end and rolls forward into the admin audit-log surface.
 *
 * BE-24 — invalidates workspace list cache after delete/restore.
 */
@Injectable()
export class DeleteWorkspaceProvider {
  private readonly logger = new Logger(DeleteWorkspaceProvider.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    private readonly findWorkspaceByIdProvider: FindWorkspaceByIdProvider,
    private readonly auditService: AuditService,
    private readonly cacheInvalidation: CacheInvalidationProvider,
  ) {}

  async softDelete(id: string): Promise<void> {
    await withRetry(
      async () => {
        const workspace = await this.findWorkspaceByIdProvider.findById(id, {
          withDeleted: true,
        });
        if (!workspace) {
          throw new NotFoundException(`Workspace with id "${id}" not found`);
        }
        if (workspace.isActive) {
          await this.workspacesRepository.update(id, { isActive: false });
        }
        await this.workspacesRepository.softDelete(id);

        await this.auditService.adminAction(
          AuditAction.WORKSPACE_DELETED,
          {},
          'Workspace',
          id,
          { previousActive: workspace.isActive },
        );
      },
      {
        maxAttempts: 3,
        baseDelayMs: 50,
        maxDelayMs: 400,
        isRetryable: isOptimisticLockError,
      },
    );

    this.cacheInvalidation
      .invalidateWorkspaceList()
      .catch(() => this.logger.warn('Failed to invalidate workspace cache'));
  }

  async restore(id: string): Promise<void> {
    const workspace = await this.findWorkspaceByIdProvider.findById(id, {
      withDeleted: true,
    });
    if (!workspace.deletedAt) {
      throw new NotFoundException(
        `Workspace with id "${id}" is not soft-deleted`,
      );
    }
    await this.workspacesRepository.restore(id);
    await this.workspacesRepository.update(id, { isActive: true });
    await this.auditService.adminAction(
      AuditAction.WORKSPACE_RESTORED,
      {},
      'Workspace',
      id,
    );

    this.cacheInvalidation
      .invalidateWorkspaceList()
      .catch(() => this.logger.warn('Failed to invalidate workspace cache'));
  }
}
