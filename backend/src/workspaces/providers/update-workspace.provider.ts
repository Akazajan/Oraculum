import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';
import { UpdateWorkspaceDto } from '../dto/update-workspace.dto';
import { FindWorkspaceByIdProvider } from './find-workspace-by-id.provider';
import {
  isOptimisticLockError,
  withRetry,
} from '../../utils/retry.util';

@Injectable()
export class UpdateWorkspaceProvider {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    private readonly findWorkspaceByIdProvider: FindWorkspaceByIdProvider,
  ) {}

  async update(id: string, dto: UpdateWorkspaceDto): Promise<Workspace> {
    // Optimistic locking: TypeORM bumps `version` on every save.
    // When two callers edit the same workspace concurrently, the loser's
    // save() throws OptimisticLockVersionMismatchError. We retry the
    // read+mutate+save cycle so the operation still succeeds cleanly and
    // workspace state remains consistent.
    return withRetry(
      async () => {
        const workspace = await this.findWorkspaceByIdProvider.findById(id);

        // If totalSeats is being increased, increase availableSeats proportionally
        if (dto.totalSeats && dto.totalSeats > workspace.totalSeats) {
          const added = dto.totalSeats - workspace.totalSeats;
          workspace.availableSeats = workspace.availableSeats + added;
        }

        // Trim any caller-supplied `version` so Object.assign can't clobber
        // the optimistic lock token with a stale value.
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
  }
}
