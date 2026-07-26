import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeadLetterProvider } from '../../providers/dead-letter.provider';
import { DeadLetterJob } from '../../entities/dead-letter-job.entity';
import { Repository } from 'typeorm';

describe('DeadLetterProvider', () => {
  let provider: DeadLetterProvider;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      create: jest.fn().mockImplementation((data) => ({ id: 'uuid-1', ...data })),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        DeadLetterProvider,
        { provide: getRepositoryToken(DeadLetterJob), useValue: repo },
      ],
    }).compile();

    provider = mod.get(DeadLetterProvider);
  });

  it('storeFailedJob creates and saves a dead-letter job', async () => {
    const result = await provider.storeFailedJob({
      queueName: 'email',
      jobId: '1',
      jobName: 'send-email',
      data: { to: 'a@b.com' },
      errorMessage: 'connection reset',
      totalAttempts: 3,
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: 'email',
        jobId: '1',
        jobName: 'send-email',
        errorMessage: 'connection reset',
        totalAttempts: 3,
      }),
    );
    expect(repo.save).toHaveBeenCalled();
    expect(result.id).toBe('uuid-1');
  });

  it('updateStatus calls repo.update with status and retriedAt', async () => {
    await provider.updateStatus('uuid-1', 'retried');
    expect(repo.update).toHaveBeenCalledWith('uuid-1', {
      status: 'retried',
      retriedAt: expect.any(Date),
    });
  });

  it('remove calls repo.delete', async () => {
    await provider.remove('uuid-1');
    expect(repo.delete).toHaveBeenCalledWith('uuid-1');
  });
});
