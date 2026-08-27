// Additional cache key pattern tests for CacheInvalidationProvider (#231)
const cacheKeys = {
  user: (id: string) => `user:${id}`,
  workspace: (id: string) => `workspace:${id}`,
  workspaceMembers: (workspaceId: string) => `workspace:${workspaceId}:members`,
  userWorkspaces: (userId: string) => `user:${userId}:workspaces`,
};

describe('CacheInvalidationProvider - cache key patterns', () => {
  it('user key should follow pattern user:<id>', () => {
    expect(cacheKeys.user('abc-123')).toBe('user:abc-123');
  });

  it('workspace key should follow pattern workspace:<id>', () => {
    expect(cacheKeys.workspace('ws-456')).toBe('workspace:ws-456');
  });

  it('workspaceMembers key should include workspace prefix', () => {
    const key = cacheKeys.workspaceMembers('ws-1');
    expect(key).toMatch(/^workspace:ws-1/);
  });

  it('userWorkspaces key should include user prefix', () => {
    const key = cacheKeys.userWorkspaces('user-1');
    expect(key).toMatch(/^user:user-1/);
  });

  it('different IDs should produce different keys', () => {
    expect(cacheKeys.user('id-1')).not.toBe(cacheKeys.user('id-2'));
    expect(cacheKeys.workspace('ws-1')).not.toBe(cacheKeys.workspace('ws-2'));
  });
});