import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Repository } from 'typeorm';
import { FindAllWorkspacesProvider, WORKSPACE_CACHE_PREFIX } from './find-all-workspaces.provider';
import { Workspace } from '../entities/workspace.entity';

describe('FindAllWorkspacesProvider (caching)', () => {
  let provider: FindAllWorkspacesProvider;
  let repo: any;
  let cacheManager: any;

  const mockCache = new Map<string, unknown>();

  beforeEach(async () => {
    mockCache.clear();

    const mockQb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
      getMany: jest.fn().mockResolvedValue([{ id: 'ws1' }]),
    };

    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    };

    cacheManager = {
      get: jest.fn((key: string) => Promise.resolve(mockCache.get(key) ?? null)),
      set: jest.fn((key: string, value: unknown, _ttl: number) => {
        mockCache.set(key, value);
        return Promise.resolve();
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FindAllWorkspacesProvider,
        { provide: getRepositoryToken(Workspace), useValue: repo },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    provider = module.get(FindAllWorkspacesProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('returns cached result on cache hit', async () => {
    const cachedResult = { data: [{ id: 'cached' }], total: 1, page: 1, limit: 20, totalPages: 1 };
    const key = (provider as any).buildCacheKey({ page: 1, limit: 20 }, {});
    mockCache.set(key, cachedResult);

    const result = await provider.findAll({ page: 1, limit: 20 });
    expect(result).toEqual(cachedResult);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('queries DB and caches result on cache miss', async () => {
    const result = await provider.findAll({ page: 1, limit: 20 });

    expect(repo.createQueryBuilder).toHaveBeenCalled();
    expect(cacheManager.set).toHaveBeenCalledWith(
      expect.stringContaining(WORKSPACE_CACHE_PREFIX),
      expect.any(Object),
      30_000,
    );
    expect(result.data).toHaveLength(1);
  });

  it('does not cache admin views', async () => {
    await provider.findAll({ page: 1, limit: 20 }, { adminView: true });

    expect(cacheManager.get).not.toHaveBeenCalled();
    expect(cacheManager.set).not.toHaveBeenCalled();
    expect(repo.createQueryBuilder).toHaveBeenCalled();
  });

  it('does not cache includeDeleted views', async () => {
    await provider.findAll({ page: 1, limit: 20 }, { includeDeleted: true });

    expect(cacheManager.get).not.toHaveBeenCalled();
    expect(cacheManager.set).not.toHaveBeenCalled();
  });

  it('generates different cache keys for different queries', async () => {
    const key1 = (provider as any).buildCacheKey({ page: 1, limit: 20 }, {});
    const key2 = (provider as any).buildCacheKey({ page: 2, limit: 20 }, {});
    const key3 = (provider as any).buildCacheKey(
      { page: 1, limit: 20, search: 'lagos' },
      {},
    );

    expect(key1).not.toEqual(key2);
    expect(key1).not.toEqual(key3);
    expect(key2).not.toEqual(key3);
  });
});
