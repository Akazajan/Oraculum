import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

describe('InvoicesService', () => {
  let service: InvoicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getRepositoryToken(Invoice), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAll should return an array', async () => {
    mockRepo.find.mockResolvedValue([]);
    const result = await service.findAll();
    expect(Array.isArray(result)).toBe(true);
  });

  it('findOne should return null for unknown id', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const result = await service.findOne('non-existent-id');
    expect(result).toBeNull();
  });
});