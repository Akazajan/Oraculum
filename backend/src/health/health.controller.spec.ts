import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  const mockHealthService = {
    check: jest.fn(),
    checkDatabase: jest.fn(),
    checkPayments: jest.fn(),
    checkStorage: jest.fn(),
  };

  beforeEach(() => {
    controller = new HealthController(mockHealthService as any);
    service = mockHealthService as any;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return overall health status', async () => {
    const expected = { status: 'healthy', timestamp: new Date().toISOString(), uptime: 100, checks: {} };
    mockHealthService.check.mockResolvedValue(expected);
    const result = await controller.check();
    expect(result).toEqual(expected);
    expect(mockHealthService.check).toHaveBeenCalledTimes(1);
  });

  it('should return database health', async () => {
    const expected = { status: 'healthy', latencyMs: 5 };
    mockHealthService.checkDatabase.mockResolvedValue(expected);
    const result = await controller.checkDatabase();
    expect(result).toEqual(expected);
  });

  it('should return payments health', async () => {
    const expected = { status: 'healthy', latencyMs: 120 };
    mockHealthService.checkPayments.mockResolvedValue(expected);
    const result = await controller.checkPayments();
    expect(result).toEqual(expected);
  });

  it('should return storage health', async () => {
    const expected = { status: 'healthy', latencyMs: 80 };
    mockHealthService.checkStorage.mockResolvedValue(expected);
    const result = await controller.checkStorage();
    expect(result).toEqual(expected);
  });
});
