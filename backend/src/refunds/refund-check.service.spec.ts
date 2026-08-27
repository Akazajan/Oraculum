import { Test, TestingModule } from '@nestjs/testing';
import { RefundCheckService } from './refund-check.service';

describe('RefundCheckService', () => {
  let service: RefundCheckService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RefundCheckService],
    }).compile();
    service = module.get<RefundCheckService>(RefundCheckService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('checkEligibility returns true for a valid bookingId', async () => {
    const result = await service.checkEligibility('booking-123');
    expect(result).toBe(true);
  });

  it('addRefundReason resolves without throwing', async () => {
    await expect(
      service.addRefundReason('booking-123', 'customer_request'),
    ).resolves.not.toThrow();
  });

  it('getRefundReasons returns a non-empty array', () => {
    const reasons = service.getRefundReasons();
    expect(Array.isArray(reasons)).toBe(true);
    expect(reasons.length).toBeGreaterThan(0);
  });
});