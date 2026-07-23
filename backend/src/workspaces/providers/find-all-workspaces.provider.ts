import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';
import { WorkspaceQueryDto } from '../dto/workspace-query.dto';

export interface PaginatedWorkspaces {
  data: Workspace[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * BE-14 — Public listing automatically excludes soft-deleted rows
 * because the TypeORM repository respects `@DeleteDateColumn`.
 * Admins can opt into tombstones with `findAll(q, { adminView: true,
 * includeDeleted: true })` for restore workflows.
 */
@Injectable()
export class FindAllWorkspacesProvider {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
  ) {}

  async findAll(
    query: WorkspaceQueryDto,
    options: {
      adminView?: boolean;
      includeDeleted?: boolean;
    } = {},
  ): Promise<PaginatedWorkspaces> {
    const { page = 1, limit = 20, type, minSeats, maxRate, search } = query;
    const { adminView = false, includeDeleted = false } = options;

    const qb: SelectQueryBuilder<Workspace> = this.workspacesRepository
      .createQueryBuilder('workspace');

    if (includeDeleted) {
      qb.withDeleted();
    }

    if (!adminView || !includeDeleted) {
      qb.where('workspace.isActive = :isActive', { isActive: true });
    }

    if (type) {
      qb.andWhere('workspace.type = :type', { type });
    }

    if (minSeats) {
      qb.andWhere('workspace.availableSeats >= :minSeats', { minSeats });
    }

    if (maxRate) {
      qb.andWhere('workspace.hourlyRate <= :maxRate', { maxRate });
    }

    if (search) {
      qb.andWhere(
        '(LOWER(workspace.name) LIKE :search OR LOWER(workspace.description) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    const total = await qb.getCount();
    const data = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('workspace.createdAt', 'DESC')
      .getMany();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
