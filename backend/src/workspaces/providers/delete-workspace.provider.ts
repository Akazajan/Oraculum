import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';
import { FindWorkspaceByIdProvider } from './find-workspace-by-id.provider';
import {
  isOptimisticLockError,
  withRetry,
} from '../../utils/retry.util';

@Injectable()
export class DeleteWorkspaceProvider {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    private readonly findWorkspaceByIdProvider: FindWorkspaceByIdProvider,
  ) {}

  async softDelete(id: string): Promise<void> {
    // Same optimistic locking discipline as UpdateWorkspaceProvider so a
    // concurrent edit cannot silently overwrite a softDelete (or vice versa).
    await withRetry(
      async () => {
        const workspace = await this.findWorkspaceByIdProvider.findById(id);
        workspace.isActive = false;
        await this.workspacesRepository.save(workspace);
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
