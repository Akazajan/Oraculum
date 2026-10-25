import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class DashboardService {
  async getMetricsSummary() {
    return {
      bookings: { total: 0, active: 0 },
      revenue: { total: 0, pending: 0 },
      users: { total: 0, active: 0 }
    };
  }

  normalizeTimezone(timezone?: string): string | undefined {
    if (timezone === undefined || timezone === null) {
      return undefined;
    }
    const trimmed = String(timezone).trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('Invalid timezone');
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    } catch {
      throw new BadRequestException(`Invalid timezone: ${trimmed}`);
    }
    return trimmed;
  }
}
