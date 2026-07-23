import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { WorkspaceTrackingService } from './workspace-tracking.service';
import { CheckInDto } from './dto/check-in.dto';
import { OccupancyQueryDto } from './dto/occupancy-query.dto';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('workspace-tracking')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@UseGuards(RolesGuard)
@Controller('workspace-tracking')
export class WorkspaceTrackingController {
  constructor(
    private readonly workspaceTrackingService: WorkspaceTrackingService,
  ) {}

  @Post('check-in')
  @Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Check into a workspace' })
  @ApiOkResponse({ description: 'Check-in recorded' })
  async checkIn(@Body() dto: CheckInDto, @GetCurrentUser('id') userId: string) {
    const data = await this.workspaceTrackingService.checkIn(dto, userId);
    return { message: 'Checked in successfully', data };
  }

  @Patch('check-out/:logId')
  @Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check out of a workspace' })
  @ApiOkResponse({ description: 'Check-out recorded' })
  async checkOut(
    @Param('logId', ParseUUIDPipe) logId: string,
    @GetCurrentUser('id') userId: string,
  ) {
    const data = await this.workspaceTrackingService.checkOut(logId, userId);
    return { message: 'Checked out successfully', data };
  }

  @Get('active')
  @Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get my current active check-in' })
  @ApiQuery({ name: 'workspaceId', required: false, type: String })
  @ApiOkResponse({ description: 'Active check-in returned (may be null)' })
  async getActiveCheckIn(
    @GetCurrentUser('id') userId: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const data = await this.workspaceTrackingService.getActiveCheckIn(
      userId,
      workspaceId,
    );
    return { message: 'Active check-in retrieved', data };
  }

  @Get('occupancy')
  @Roles(UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get current occupancy for all (or one) workspace' })
  @ApiQuery({ name: 'workspaceId', required: false, type: String })
  @ApiOkResponse({ description: 'Occupancy returned' })
  async getCurrentOccupancy(@Query('workspaceId') workspaceId?: string) {
    const data =
      await this.workspaceTrackingService.getCurrentOccupancy(workspaceId);
    return { message: 'Occupancy retrieved', data };
  }

  @Get('utilization')
  @Roles(UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get utilization statistics' })
  @ApiOkResponse({ description: 'Utilization returned' })
  async getUtilizationStats(@Query() query: OccupancyQueryDto) {
    const data = await this.workspaceTrackingService.getUtilizationStats(query);
    return { message: 'Utilization stats retrieved', data };
  }

  @Get('logs')
  @Roles(UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get recent check-in logs' })
  @ApiQuery({ name: 'workspaceId', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ description: 'Recent logs returned' })
  async getRecentLogs(
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.workspaceTrackingService.getRecentLogs(
      workspaceId,
      limit ? Number(limit) : 50,
    );
    return { message: 'Recent logs retrieved', data };
  }
}
