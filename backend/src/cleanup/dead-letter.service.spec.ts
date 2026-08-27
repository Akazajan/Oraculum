import { Test, TestingModule } from '@nestjs/testing';
import { DeadLetterService } from './dead-letter.service';

describe('DeadLetterService', () => {
  let service: DeadLetterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeadLetterService],
    }).compile();

    service = module.get<DeadLetterService>(DeadLetterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should retry a failed job without throwing', async () => {
    await expect(service.retry('job-id-1')).resolves.not.toThrow();
  });

  it('should replay a dead-letter message without throwing', async () => {
    await expect(service.replay('msg-id-1')).resolves.not.toThrow();
  });

  it('should list dead letters as an array', async () => {
    const result = await service.list();
    expect(Array.isArray(result)).toBe(true);
  });
});