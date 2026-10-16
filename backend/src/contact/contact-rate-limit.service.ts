import { Injectable } from '@nestjs/common';

@Injectable()
export class ContactRateLimitService {
  private requestMap = new Map<string, number[]>();

  isRateLimited(ip: string | null | undefined): boolean {
    const key = this.normalizeIp(ip);
    const now = Date.now();
    const timestamps = this.requestMap.get(key) || [];
    const recentRequests = timestamps.filter((t) => now - t < 60000);

    if (recentRequests.length >= 5) return true;

    recentRequests.push(now);
    this.requestMap.set(key, recentRequests);
    return false;
  }

  normalizeIp(ip: string | null | undefined): string {
    if (!ip) return 'unknown';
    const trimmed = ip.trim();
    if (!trimmed) return 'unknown';

    const ipv4Regex =
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = trimmed.match(ipv4Regex);
    if (match) {
      return match.slice(1, 5).map((octet) => parseInt(octet, 10).toString()).join('.');
    }

    const ipv4MappedIpv6Regex = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
    const mappedMatch = trimmed.match(ipv4MappedIpv6Regex);
    if (mappedMatch) {
      const ipv4 = mappedMatch[1];
      const normalized = this.normalizeIp(ipv4);
      return normalized !== 'unknown' ? normalized : trimmed;
    }

    return trimmed;
  }

  validateContactData(data: any): boolean {
    if (!data.email || !data.message) return false;
    if (data.message.length < 10 || data.message.length > 5000) return false;
    if (!this.isValidEmail(data.email)) return false;
    return true;
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  sanitizeInput(text: string): string {
    return text.replace(/[<>\"']/g, '').trim();
  }
}
