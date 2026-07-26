import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export const WORKSPACE_CACHE_PREFIX = 'workspaces:';
export const BOOKING_CACHE_PREFIX = 'bookings:';

/**
 * BE-24 — Centralised cache invalidation for workspace and booking
 * lists. Every mutation provider calls the appropriate `invalidate*`
 * method after a successful DB write so the next read fetches fresh
 * data.
 *
 * Errors are caught and logged — cache invalidation must never break
 * the user-facing request.
 */
@Injectable()
export class CacheInvalidationProvider {
  private readonly logger = new Logger(CacheInvalidationProvider.name);

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async invalidateWorkspaceList(): Promise<void> {
    try {
      const store = (this.cacheManager as any).store;
      if (store?.keys) {
        const keys: string[] = await store.keys(
          `${WORKSPACE_CACHE_PREFIX}list:*`,
        );
        if (keys?.length) {
          await Promise.all(keys.map((k) => this.cacheManager.del(k)));
          this.logger.log(
            `Invalidated ${keys.length} workspace list cache entry/entries.`,
          );
          return;
        }
      }
      this.logger.log('Workspace list cache invalidated (store without keys).');
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate workspace list cache: ${(err as Error).message}`,
      );
    }
  }

  async invalidateBookingList(workspaceId?: string): Promise<void> {
    try {
      const store = (this.cacheManager as any).store;
      if (store?.keys) {
        const pattern = workspaceId
          ? `${BOOKING_CACHE_PREFIX}list:*${workspaceId}*`
          : `${BOOKING_CACHE_PREFIX}list:*`;
        const keys: string[] = await store.keys(pattern);
        if (keys?.length) {
          await Promise.all(keys.map((k) => this.cacheManager.del(k)));
          this.logger.log(
            `Invalidated ${keys.length} booking list cache entry/entries.`,
          );
          return;
        }
      }
      this.logger.log('Booking list cache invalidated (store without keys).');
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate booking list cache: ${(err as Error).message}`,
      );
    }
  }
}
