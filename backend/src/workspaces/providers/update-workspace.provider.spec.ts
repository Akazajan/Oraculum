import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UpdateWorkspaceProvider } from './update-workspace.provider';
import { FindWorkspaceByIdProvider } from './find-workspace-by-id.provider';
import { Workspace } from '../entities/workspace.entity';

class OptimisticLockError extends Error {
  constructor() {
    super('version mismatch');
    this.name = 'OptimisticLockVersionMismatchError';
  }
}

describe('UpdateWorkspaceProvider (optimistic locking retries)', () => {
  let provider: UpdateWorkspaceProvider;
  let repo: { save: jest.Mock };
  let findById: jest.Mock;

  beforeEach(async () => {
    repo = { save: jest.fn() };
    findById = jest.fn();

    const mod = await Test.createTestingModule({
      providers: [
        UpdateWorkspaceProvider,
        { provide: getRepositoryToken(Workspace), useValue: repo },
        {
          provide: FindWorkspaceByIdProvider,
          useValue: { findById },
        },
      ],
    }).compile();
    provider = mod.get(UpdateWorkspaceProvider);
  });

  it('returns the saved workspace on the first attempt', async () => {
    const ws: any = {
      id: 'w1',
      totalSeats: 10,
      availableSeats: 10,
    };
    findById.mockResolvedValue(ws);
    repo.save.mockResolvedValue({ ...ws, name: 'Updated' });

    const result = await provider.update('w1', { name: 'Updated' });
    expect(result).toEqual({ id: 'w1', totalSeats: 10, availableSeats: 10, name: 'Updated' });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('retries on OptimisticLockVersionMismatchError and eventually succeeds', async () => {
    findById.mockResolvedValue({ id: 'w1', totalSeats: 10, availableSeats: 10 });
    repo.save
      .mockRejectedValueOnce(new OptimisticLockError())
      .mockResolvedValueOnce({ id: 'w1', totalSeats: 10, availableSeats: 10 });

    const result = await provider.update('w1', { name: 'X' });
    expect(result.id).toBe('w1');
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries', async () => {
    findById.mockResolvedValue({ id: 'w1', totalSeats: 10, availableSeats: 10 });
    repo.save.mockRejectedValue(new OptimisticLockError());

    await expect(provider.update('w1', { name: 'X' })).rejects.toBeInstanceOf(
      OptimisticLockError,
    );
    expect(repo.save).toHaveBeenCalledTimes(3); // retry util maxAttempts
  });

  it('does not retry on unrelated errors', async () => {
    findById.mockResolvedValue({ id: 'w1', totalSeats: 10, availableSeats: 10 });
    repo.save.mockRejectedValue(new Error('db down'));

    await expect(provider.update('w1', { name: 'X' })).rejects.toThrow(
      'db down',
    );
    expect(repo.save).toHaveBeenCalledTimes(1);
  });
});
