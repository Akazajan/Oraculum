import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get my notifications' })
  @ApiOkResponse({ description: 'Notifications retrieved' })
  async findAll(
    @Query() query: NotificationQueryDto,
    @GetCurrentUser('id') userId: string,
  ) {
    const result = await this.notificationsService.findAll(userId, query);
    return { message: 'Notifications retrieved successfully', ...result };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiOkResponse({ description: 'Notification marked as read' })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @GetCurrentUser('id') userId: string,
  ) {
    await this.notificationsService.markRead(id, userId);
    return { message: 'Notification marked as read' };
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiOkResponse({ description: 'All notifications marked as read' })
  async markAllRead(@GetCurrentUser('id') userId: string) {
    await this.notificationsService.markAllRead(userId);
    return { message: 'All notifications marked as read' };
  }
}
