import { HealthService } from './health.service';

const mockUserRepo = {
  query: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

jest.mock('axios');
jest.mock('cloudinary', () => ({
  v2: {
    api: {
      ping: jest.fn(),
    },
  },
}));

import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(() => {
    service = new HealthService(mockUserRepo as any, mockConfigService as any);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkDatabase', () => {
    it('should return healthy when database responds', async () => {
      mockUserRepo.query.mockResolvedValue([{ '?column?': 1 }]);
      const result = await service.checkDatabase();
      expect(result.status).toBe('healthy');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockUserRepo.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return unhealthy on database error', async () => {
      mockUserRepo.query.mockRejectedValue(new Error('Connection refused'));
      const result = await service.checkDatabase();
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection refused');
    });
  });

  describe('checkPayments', () => {
    it('should return unhealthy when PAYSTACK_SECRET_KEY not configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      const result = await service.checkPayments();
      expect(result.status).toBe('unhealthy');
      expect(result.error).toContain('PAYSTACK_SECRET_KEY not configured');
    });

    it('should return healthy when Paystack responds', async () => {
      mockConfigService.get.mockReturnValue('sk_test_fake');
      (axios.get as jest.Mock).mockResolvedValue({ data: { message: 'Balance retrieved', status: true } });
      const result = await service.checkPayments();
      expect(result.status).toBe('healthy');
    });

    it('should return unhealthy on Paystack error', async () => {
      mockConfigService.get.mockReturnValue('sk_test_fake');
      (axios.get as jest.Mock).mockRejectedValue(new Error('Network timeout'));
      const result = await service.checkPayments();
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Network timeout');
    });
  });

  describe('checkStorage', () => {
    it('should return healthy when Cloudinary responds', async () => {
      (cloudinary.api.ping as jest.Mock).mockResolvedValue({ status: 'ok' });
      const result = await service.checkStorage();
      expect(result.status).toBe('healthy');
    });

    it('should return unhealthy on Cloudinary error', async () => {
      (cloudinary.api.ping as jest.Mock).mockRejectedValue(new Error('Cloudinary down'));
      const result = await service.checkStorage();
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Cloudinary down');
    });
  });

  describe('check (overall)', () => {
    it('should return healthy when all services are healthy', async () => {
      mockUserRepo.query.mockResolvedValue([{ '?column?': 1 }]);
      mockConfigService.get.mockReturnValue(undefined);
      (cloudinary.api.ping as jest.Mock).mockResolvedValue({ status: 'ok' });

      const result = await service.check();
      expect(result.status).toBe('healthy');
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.storage.status).toBe('healthy');
    });

    it('should return unhealthy when any service is unhealthy', async () => {
      mockUserRepo.query.mockRejectedValue(new Error('DB down'));
      (cloudinary.api.ping as jest.Mock).mockResolvedValue({ status: 'ok' });

      const result = await service.check();
      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('unhealthy');
    });
  });
});
