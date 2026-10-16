import { Test, TestingModule } from '@nestjs/testing';
import { MonitoringService } from './monitoring.service';

describe('MonitoringService', () => {
  let service: MonitoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MonitoringService],
    }).compile();
    service = module.get<MonitoringService>(MonitoringService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getMetrics returns an object with expected keys', async () => {
    const metrics = await service.getMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics).toBe('object');
  });

  it('recordEvent does not throw for a valid event', () => {
    expect(() =>
      service.recordEvent('payment.completed', { amount: 100, currency: 'NGN' }),
    ).not.toThrow();
  });

  it('recordEvent does not throw for an error event', () => {
    expect(() =>
      service.recordEvent('payment.failed', { reason: 'insufficient_funds' }),
    ).not.toThrow();
  });
});