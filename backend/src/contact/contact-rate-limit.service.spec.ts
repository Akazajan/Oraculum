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

  it('should not throw when IP is null or undefined', () => {
    expect(() => service.isRateLimited(null)).not.toThrow();
    expect(() => service.isRateLimited(undefined)).not.toThrow();
    expect(service.isRateLimited(null)).toBe(false);
    expect(service.isRateLimited(undefined)).toBe(false);
  });

  it('should treat null and undefined IPs as the same bucket', () => {
    service.isRateLimited(null);
    service.isRateLimited(undefined);
    service.isRateLimited(null);
    service.isRateLimited(undefined);
    service.isRateLimited(null);
    expect(service.isRateLimited(undefined)).toBe(true);
  });

  it('should normalize equivalent IPv4 representations to the same bucket', () => {
    service.isRateLimited('192.168.1.1');
    service.isRateLimited('192.168.001.001');
    service.isRateLimited('192.168.001.001');
    service.isRateLimited('192.168.1.1');
    service.isRateLimited('192.168.001.001');
    expect(service.isRateLimited('192.168.1.1')).toBe(true);
  });

  it('should normalize leading-zero octets', () => {
    const key1 = service.normalizeIp('010.020.030.040');
    const key2 = service.normalizeIp('10.20.30.40');
    expect(key1).toBe(key2);
  });

  it('should return "unknown" for empty or whitespace IPs', () => {
    expect(service.normalizeIp(null)).toBe('unknown');
    expect(service.normalizeIp(undefined)).toBe('unknown');
    expect(service.normalizeIp('')).toBe('unknown');
    expect(service.normalizeIp('   ')).toBe('unknown');
  });

  it('should leave IPv6 and non-IPv4 addresses unchanged', () => {
    const ipv6 = '::1';
    expect(service.normalizeIp(ipv6)).toBe(ipv6);
    const host = 'example.com';
    expect(service.normalizeIp(host)).toBe(host);
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