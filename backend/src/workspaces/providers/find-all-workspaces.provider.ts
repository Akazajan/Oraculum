import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
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

export const WORKSPACE_CACHE_PREFIX = 'workspaces:';
export const WORKSPACE_LIST_TTL = 30_000;

/**
 * BE-14 — Public listing automatically excludes soft-deleted rows
 * because the TypeORM repository respects `@DeleteDateColumn`.
 * Admins can opt into tombstones with `findAll(q, { adminView: true,
 * includeDeleted: true })` for restore workflows.
 *
 * BE-23 — Results are cached in Redis with a TTL. Cache keys are
 * derived from the serialised query + options so that every unique
 * filter combination has its own entry. Admin views are never cached.
 */
@Injectable()
export class FindAllWorkspacesProvider {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  private buildCacheKey(
    query: WorkspaceQueryDto,
    options: { adminView?: boolean; includeDeleted?: boolean },
  ): string {
    const params = {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      type: query.type ?? null,
      minSeats: query.minSeats ?? null,
      maxRate: query.maxRate ?? null,
      search: query.search ?? null,
      adminView: options.adminView ?? false,
      includeDeleted: options.includeDeleted ?? false,
    };
    const hash = Buffer.from(JSON.stringify(params)).toString('base64url');
    return `${WORKSPACE_CACHE_PREFIX}list:${hash}`;
  }

  async findAll(
    query: WorkspaceQueryDto,
    options: {
      adminView?: boolean;
      includeDeleted?: boolean;
    } = {},
  ): Promise<PaginatedWorkspaces> {
    const { adminView = false, includeDeleted = false } = options;

    if (!adminView && !includeDeleted) {
      const key = this.buildCacheKey(query, options);
      const cached = await this.cacheManager.get<PaginatedWorkspaces>(key);
      if (cached) return cached;
    }

    const result = await this.fetchFromDb(query, options);

    if (!adminView && !includeDeleted) {
      const key = this.buildCacheKey(query, options);
      await this.cacheManager.set(key, result, WORKSPACE_LIST_TTL);
    }

    return result;
  }

  private async fetchFromDb(
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
