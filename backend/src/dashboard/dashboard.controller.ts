import { Controller, Get, Header } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

/**
 * Short-lived cache window for read-only dashboard responses.
 * `private` keeps user-specific data out of shared caches (CDNs, proxies);
 * only the end-user's browser may reuse the response within the max-age window.
 */
const DASHBOARD_CACHE_CONTROL = 'private, max-age=30';

@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Read-only endpoint. Cacheable for 30s by the browser only (private).
   * Mutation endpoints, if added, must not be decorated with this header.
   */
  @Get('summary')
  @Header('Cache-Control', DASHBOARD_CACHE_CONTROL)
  async getSummary() {
    return this.dashboardService.getMetricsSummary();
  }
}
