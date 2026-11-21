import { Test } from '@nestjs/testing';
import { DeadLetterService } from '../dead-letter.service';
import { DeadLetterProvider } from '../../providers/dead-letter.provider';

describe('DeadLetterService', () => {
  let service: DeadLetterService;
  let provider: {
    findAll: jest.Mock;
    findById: jest.Mock;
    updateStatus: jest.Mock;
    remove: jest.Mock;
    storeFailedJob: jest.Mock;
  };

  beforeEach(async () => {
    provider = {
      findAll: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      remove: jest.fn(),
      storeFailedJob: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        DeadLetterService,
        { provide: DeadLetterProvider, useValue: provider },
      ],
    }).compile();

    service = mod.get(DeadLetterService);
  });

  it('findAll delegates to provider', async () => {
    provider.findAll.mockResolvedValue({ jobs: [], total: 0 });
    const result = await service.findAll({ queueName: 'email' });
    expect(provider.findAll).toHaveBeenCalledWith({ queueName: 'email' });
    expect(result.total).toBe(0);
  });

  it('markRetried updates status to retried', async () => {
    await service.markRetried('uuid-1');
    expect(provider.updateStatus).toHaveBeenCalledWith('uuid-1', 'retried');
  });

  it('markResolved updates status to resolved', async () => {
    await service.markResolved('uuid-1');
    expect(provider.updateStatus).toHaveBeenCalledWith('uuid-1', 'resolved');
  });

  it('remove delegates to provider', async () => {
    await service.remove('uuid-1');
    expect(provider.remove).toHaveBeenCalledWith('uuid-1');
  });

  describe('deduplication of repeated failures', () => {
    const payload = {
      queueName: 'email',
      jobId: 'job-42',
      jobName: 'send-email',
      data: { to: 'user@example.com' },
      errorMessage: 'SMTP timeout (latest)',
      totalAttempts: 5,
      attemptsResult: { lastCode: 'ETIMEDOUT' },
    };

    it('recordFailure replaces existing pending entries for the same job with the latest failure', async () => {
      provider.findAll.mockResolvedValue({
        jobs: [
          { id: 'old-1', queueName: 'email', jobId: 'job-42', errorMessage: 'first' },
          { id: 'old-2', queueName: 'email', jobId: 'job-42', errorMessage: 'second' },
          { id: 'other', queueName: 'email', jobId: 'job-99', errorMessage: 'other' },
        ],
        total: 3,
      });
      provider.storeFailedJob.mockImplementation(async (p) => ({ id: 'new', ...p }));

      const result = await service.recordFailure(payload);

      expect(provider.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ queueName: 'email', status: 'pending' }),
      );
      expect(provider.remove).toHaveBeenCalledTimes(2);
      expect(provider.remove).toHaveBeenCalledWith('old-1');
      expect(provider.remove).toHaveBeenCalledWith('old-2');
      expect(provider.remove).not.toHaveBeenCalledWith('other');
      expect(provider.storeFailedJob).toHaveBeenCalledWith(payload);
      expect(result.errorMessage).toBe('SMTP timeout (latest)');
      expect(result.totalAttempts).toBe(5);
      expect(result.attemptsResult).toEqual({ lastCode: 'ETIMEDOUT' });
    });

    it('recordFailure stores a new entry when no prior failure exists', async () => {
      provider.findAll.mockResolvedValue({ jobs: [], total: 0 });
      provider.storeFailedJob.mockImplementation(async (p) => ({ id: 'new', ...p }));

      await service.recordFailure(payload);

      expect(provider.remove).not.toHaveBeenCalled();
      expect(provider.storeFailedJob).toHaveBeenCalledTimes(1);
    });

    it('findAll collapses duplicates for the same job keeping the latest failure metadata', async () => {
      provider.findAll.mockResolvedValue({
        jobs: [
          {
            id: 'a',
            queueName: 'email',
            jobId: 'job-42',
            errorMessage: 'older',
            lastAttemptAt: new Date('2026-01-01T00:00:00Z'),
          },
          {
            id: 'b',
            queueName: 'email',
            jobId: 'job-42',
            errorMessage: 'newest',
            lastAttemptAt: new Date('2026-01-03T00:00:00Z'),
          },
          {
            id: 'c',
            queueName: 'email',
            jobId: 'job-99',
            errorMessage: 'unrelated',
            lastAttemptAt: new Date('2026-01-02T00:00:00Z'),
          },
        ],
        total: 3,
      });

      const result = await service.findAll({ queueName: 'email' });

      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
      const job42 = result.jobs.find((j) => j.jobId === 'job-42');
      expect(job42?.id).toBe('b');
      expect(job42?.errorMessage).toBe('newest');
    });
  });
});
