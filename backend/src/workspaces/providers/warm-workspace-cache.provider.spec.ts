import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository } from 'typeorm';
import { WarmWorkspaceCacheProvider } from './warm-workspace-cache.provider';
import { Workspace } from '../entities/workspace.entity';
import { WORKSPACE_CACHE_PREFIX } from './find-all-workspaces.provider';

describe('WarmWorkspaceCacheProvider', () => {
  let provider: WarmWorkspaceCacheProvider;
  let repo: any;
  let cacheManager: any;

  beforeEach(async () => {
    const mockQb: any = {
      where: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(5),
      getMany: jest.fn().mockResolvedValue([{ id: 'ws1' }, { id: 'ws2' }]),
    };

    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    };

    cacheManager = {
      set: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarmWorkspaceCacheProvider,
        { provide: getRepositoryToken(Workspace), useValue: repo },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    provider = module.get(WarmWorkspaceCacheProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('warms the workspace cache on module init', async () => {
    await provider.onModuleInit();

    expect(repo.createQueryBuilder).toHaveBeenCalled();
    expect(cacheManager.set).toHaveBeenCalledWith(
      expect.stringContaining(WORKSPACE_CACHE_PREFIX),
      expect.objectContaining({ total: 5, data: expect.any(Array) }),
      30_000,
    );
  });

  it('does not throw if cache warming fails', async () => {
    cacheManager.set.mockRejectedValue(new Error('redis down'));

    await expect(provider.onModuleInit()).resolves.not.toThrow();
  });
});
