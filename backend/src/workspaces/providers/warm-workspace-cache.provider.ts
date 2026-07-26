import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../entities/workspace.entity';
import { WORKSPACE_CACHE_PREFIX, WORKSPACE_LIST_TTL } from './find-all-workspaces.provider';

/**
 * BE-23 — Warms the workspace list cache on application startup so
 * the very first public request does not suffer a cold-cache penalty.
 *
 * Only the default (unfiltered, public) page is pre-warmed. Filtered
 * and admin queries are cached on first access.
 */
@Injectable()
export class WarmWorkspaceCacheProvider implements OnModuleInit {
  private readonly logger = new Logger(WarmWorkspaceCacheProvider.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const page = 1;
      const limit = 20;

      const qb = this.workspacesRepository
        .createQueryBuilder('workspace')
        .where('workspace.isActive = :isActive', { isActive: true });

      const total = await qb.getCount();
      const data = await qb
        .skip((page - 1) * limit)
        .take(limit)
        .orderBy('workspace.createdAt', 'DESC')
        .getMany();

      const result = {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };

      const key = `${WORKSPACE_CACHE_PREFIX}list:${Buffer.from(
        JSON.stringify({
          page,
          limit,
          type: null,
          minSeats: null,
          maxRate: null,
          search: null,
          adminView: false,
          includeDeleted: false,
        }),
      ).toString('base64url')}`;

      await this.cacheManager.set(key, result, WORKSPACE_LIST_TTL);
      this.logger.log('Workspace list cache warmed successfully.');
    } catch (err) {
      this.logger.warn(
        `Failed to warm workspace cache: ${(err as Error).message}`,
      );
    }
  }
}
