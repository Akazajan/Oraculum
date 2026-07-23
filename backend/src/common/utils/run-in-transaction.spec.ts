import { runInTransaction } from './run-in-transaction';

interface FakeManager {
  invoked: boolean;
}

interface FakeDataSource {
  transaction: jest.Mock;
}

describe('runInTransaction', () => {
  it('returns the value produced by the unit of work', async () => {
    const ds: FakeDataSource = {
      transaction: jest.fn(
        async (work: (manager: FakeManager) => Promise<unknown>) => {
          const manager: FakeManager = { invoked: false };
          return work(manager);
        },
      ),
    };

    const result = await runInTransaction(ds as never, async (manager) => {
      (manager as unknown as FakeManager).invoked = true;
      return 42;
    });

    expect(result).toBe(42);
    expect(ds.transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates errors thrown by the unit of work', async () => {
    const ds: FakeDataSource = {
      transaction: jest.fn(async () => {
        // Simulate TypeORM rolling back and re-throwing on error.
        throw new Error('boom');
      }),
    };

    await expect(
      runInTransaction(ds as never, async () => undefined),
    ).rejects.toThrow('boom');
  });
});
