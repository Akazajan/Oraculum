import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceTrackingService } from './workspace-tracking.service';
import { getRepositoryToken } from '@nestjs/typeorm';

const mockRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
};

describe('WorkspaceTrackingService', () => {
  let service: WorkspaceTrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceTrackingService,
        { provide: getRepositoryToken('WorkspaceTracking'), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<WorkspaceTrackingService>(WorkspaceTrackingService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('checkIn should not throw for a valid userId', async () => {
    mockRepo.create.mockReturnValue({});
    mockRepo.save.mockResolvedValue({ id: '1', userId: 'user-1' });
    await expect(service.checkIn('user-1', 'workspace-1')).resolves.not.toThrow();
  });

  it('checkOut should not throw for a valid userId', async () => {
    mockRepo.findOne.mockResolvedValue({ id: '1', userId: 'user-1', checkedInAt: new Date() });
    mockRepo.save.mockResolvedValue({});
    await expect(service.checkOut('user-1', 'workspace-1')).resolves.not.toThrow();
  });
});