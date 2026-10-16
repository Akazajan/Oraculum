import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

const mockRepo = { query: jest.fn() };
const mockConfig = { get: jest.fn() };

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: getRepositoryToken('User'), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('checkDatabase returns healthy when query succeeds', async () => {
    mockRepo.query.mockResolvedValue([{ '?column?': 1 }]);
    const result = await service.checkDatabase();
    expect(result.status).toBe('healthy');
    expect(mockRepo.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('checkDatabase returns unhealthy when query throws', async () => {
    mockRepo.query.mockRejectedValue(new Error('Connection refused'));
    const result = await service.checkDatabase();
    expect(result.status).toBe('unhealthy');
    expect(result.error).toBe('Connection refused');
  });

  it('check() result includes database key', async () => {
    mockRepo.query.mockResolvedValue([]);
    mockConfig.get.mockReturnValue(undefined);
    const result = await service.check();
    expect(result.checks).toHaveProperty('database');
  });
});