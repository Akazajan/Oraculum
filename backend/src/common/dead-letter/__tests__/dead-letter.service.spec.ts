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
  };

  beforeEach(async () => {
    provider = {
      findAll: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      remove: jest.fn(),
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
});
