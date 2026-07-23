import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guard/jwt.auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorators';
import { UserRole } from '../users/enums/userRoles.enum';
import { CurrentUser } from '../auth/decorators/current.user.decorators';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('dashboard')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get dashboard stats for the current user' })
  @ApiOkResponse({ description: 'User dashboard stats' })
  async getStats(@CurrentUser() user: User) {
    const data = await this.dashboardService.getUserStats(user.id);
    return { success: true, data };
  }

  @Get('activity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get dashboard activity feed' })
  @ApiOkResponse({ description: 'Activity feed returned' })
  async getActivity() {
    const data = await this.dashboardService.getActivity();
    return { success: true, data };
  }

  @Get('admin/stats')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get admin-only aggregate stats' })
  @ApiOkResponse({ description: 'Admin stats returned' })
  async getAdminStats() {
    const data = await this.dashboardService.getAdminStats();
    return { success: true, data };
  }

  @Get('admin/users')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'List users for the admin dashboard' })
  @ApiOkResponse({ description: 'Admin user list returned' })
  async getAdminUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
  ) {
    const data = await this.dashboardService.getUsers(
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
      search,
    );
    return { success: true, ...data };
  }

  @Get('admin/analytics')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.STAFF)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Get admin analytics over a date range' })
  @ApiOkResponse({ description: 'Analytics returned' })
  async getAdminAnalytics(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.dashboardService.getAdminAnalytics(from, to);
    return { success: true, data };
  }

  @Get('member')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get member dashboard' })
  @ApiOkResponse({ description: 'Member dashboard returned' })
  async getMemberDashboard(@GetCurrentUser('id') userId: string) {
    const data = await this.dashboardService.getMemberDashboard(userId);
    return { success: true, data };
  }

  @Get('member/bookings')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get member bookings for the dashboard' })
  @ApiOkResponse({ description: 'Member bookings returned' })
  async getMemberBookings(
    @GetCurrentUser('id') userId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const data = await this.dashboardService.getMemberBookings(
      userId,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
    );
    return { success: true, ...data };
  }

  @Get('member/payments')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get member payments for the dashboard' })
  @ApiOkResponse({ description: 'Member payments returned' })
  async getMemberPayments(
    @GetCurrentUser('id') userId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const data = await this.dashboardService.getMemberPayments(
      userId,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
    );
    return { success: true, ...data };
  }

  @Get('member/invoices')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get member invoices for the dashboard' })
  @ApiOkResponse({ description: 'Member invoices returned' })
  async getMemberInvoices(
    @GetCurrentUser('id') userId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const data = await this.dashboardService.getMemberInvoices(
      userId,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
    );
    return { success: true, ...data };
  }

  @Get('member/check-ins')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get member check-ins for the dashboard' })
  @ApiOkResponse({ description: 'Member check-ins returned' })
  async getMemberCheckIns(
    @GetCurrentUser('id') userId: string,
    @Query('limit') limit: string = '10',
  ) {
    const data = await this.dashboardService.getMemberCheckIns(
      userId,
      Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
    );
    return { success: true, data };
  }
}
