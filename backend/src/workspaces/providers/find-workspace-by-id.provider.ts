import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';

/**
 * BE-14 — Default workspace lookup excludes soft-deleted rows.
 * `findById(..., { withDeleted: true })` is used by admin restore
 * endpoints so the public surface stays clean.
 */
@Injectable()
export class FindWorkspaceByIdProvider {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
  ) {}

  async findById(
    id: string,
    options: { withDeleted?: boolean } = {},
  ): Promise<Workspace> {
    const workspace = await this.workspacesRepository.findOne({
      where: { id },
      withDeleted: options.withDeleted ?? false,
    });
    if (!workspace) {
      throw new NotFoundException(`Workspace with id "${id}" not found`);
    }
    return workspace;
  }
}
