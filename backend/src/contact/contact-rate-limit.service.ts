import { Injectable } from '@nestjs/common';

@Injectable()
export class ContactRateLimitService {
  private requestMap = new Map<string, number[]>();

  isRateLimited(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.requestMap.get(ip) || [];
    const recentRequests = timestamps.filter((t) => now - t < 60000);

    if (recentRequests.length >= 5) return true;

    recentRequests.push(now);
    this.requestMap.set(ip, recentRequests);
    return false;
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
