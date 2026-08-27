import { Test, TestingModule } from '@nestjs/testing';
import { ContactRateLimitService } from './contact-rate-limit.service';

describe('ContactRateLimitService', () => {
  let service: ContactRateLimitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContactRateLimitService],
    }).compile();
    service = module.get<ContactRateLimitService>(ContactRateLimitService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should not rate-limit first request from an IP', () => {
    expect(service.isRateLimited('1.2.3.4')).toBe(false);
  });

  it('should rate-limit after 5 requests within 60 seconds', () => {
    const ip = '5.6.7.8';
    for (let i = 0; i < 5; i++) service.isRateLimited(ip);
    expect(service.isRateLimited(ip)).toBe(true);
  });

  it('validateContactData returns false for missing fields', () => {
    expect(service.validateContactData({ email: '', message: '' })).toBe(false);
  });

  it('validateContactData returns true for valid data', () => {
    expect(service.validateContactData({
      email: 'test@example.com',
      message: 'This is a valid message',
    })).toBe(true);
  });

  it('sanitizeInput removes HTML special chars', () => {
    expect(service.sanitizeInput('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
  });
});