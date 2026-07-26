import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheInvalidationProvider, WORKSPACE_CACHE_PREFIX, BOOKING_CACHE_PREFIX } from './cache-invalidation.provider';

describe('CacheInvalidationProvider', () => {
  let provider: CacheInvalidationProvider;
  let cacheManager: any;

  beforeEach(async () => {
    cacheManager = {
      del: jest.fn().mockResolvedValue(undefined),
      store: {
        keys: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheInvalidationProvider,
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    provider = module.get(CacheInvalidationProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('invalidateWorkspaceList', () => {
    it('deletes workspace list cache keys', async () => {
      cacheManager.store.keys.mockResolvedValue([
        'workspaces:list:abc',
        'workspaces:list:def',
      ]);

      await provider.invalidateWorkspaceList();

      expect(cacheManager.store.keys).toHaveBeenCalledWith(
        `${WORKSPACE_CACHE_PREFIX}list:*`,
      );
      expect(cacheManager.del).toHaveBeenCalledTimes(2);
    });

    it('does not throw on cache errors', async () => {
      cacheManager.store.keys.mockRejectedValue(new Error('redis down'));

      await expect(provider.invalidateWorkspaceList()).resolves.not.toThrow();
    });
  });

  describe('invalidateBookingList', () => {
    it('deletes all booking list cache keys when no workspaceId', async () => {
      cacheManager.store.keys.mockResolvedValue([
        'bookings:list:xyz',
      ]);

      await provider.invalidateBookingList();

      expect(cacheManager.store.keys).toHaveBeenCalledWith(
        `${BOOKING_CACHE_PREFIX}list:*`,
      );
      expect(cacheManager.del).toHaveBeenCalledWith('bookings:list:xyz');
    });

    it('deletes workspace-specific booking cache keys', async () => {
      cacheManager.store.keys.mockResolvedValue([
        'bookings:list:ws1-abc',
      ]);

      await provider.invalidateBookingList('ws1');

      expect(cacheManager.store.keys).toHaveBeenCalledWith(
        expect.stringContaining('ws1'),
      );
      expect(cacheManager.del).toHaveBeenCalledWith('bookings:list:ws1-abc');
    });

    it('does not throw on cache errors', async () => {
      cacheManager.store.keys.mockRejectedValue(new Error('redis down'));

      await expect(provider.invalidateBookingList()).resolves.not.toThrow();
    });
  });
});
