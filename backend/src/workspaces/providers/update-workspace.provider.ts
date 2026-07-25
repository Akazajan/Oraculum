import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';
import { FindWorkspaceByIdProvider } from './find-workspace-by-id.provider';
import {
  isOptimisticLockError,
  withRetry,
} from '../../utils/retry.util';
import { CacheInvalidationProvider } from '../../common/providers/cache-invalidation.provider';

@Injectable()
export class UpdateWorkspaceProvider {
  private readonly logger = new Logger(UpdateWorkspaceProvider.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    private readonly findWorkspaceByIdProvider: FindWorkspaceByIdProvider,
    private readonly cacheInvalidation: CacheInvalidationProvider,
  ) {}

  async update(id: string, dto: UpdateWorkspaceDto): Promise<Workspace> {
    const result = await withRetry(
      async () => {
        const workspace = await this.findWorkspaceByIdProvider.findById(id);

        if (dto.totalSeats && dto.totalSeats > workspace.totalSeats) {
          const added = dto.totalSeats - workspace.totalSeats;
          workspace.availableSeats = workspace.availableSeats + added;
        }

        const safeDto = { ...dto };
        delete (safeDto as { version?: number }).version;

        Object.assign(workspace, safeDto);
        return this.workspacesRepository.save(workspace);
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

    return result;
  }
}
