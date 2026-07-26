import { Injectable } from '@nestjs/common';

@Injectable()
export class DashboardService {
  async getMetricsSummary() {
    return {
      bookings: { total: 0, active: 0 },
      revenue: { total: 0, pending: 0 },
      users: { total: 0, active: 0 }
    };
  }
}
