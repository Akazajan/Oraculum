import {
  Controller,
  Get,
  Put,
  Body,
  Param,
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
import { NotificationPreferencesService } from './notification-preferences.service';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { NotificationChannel } from './enums/notification-channel.enum';

@ApiTags('notification-preferences')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.USER, UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get my notification preferences' })
  @ApiOkResponse({ description: 'Preferences retrieved' })
  async findAll(@GetCurrentUser('id') userId: string) {
    const data = await this.preferencesService.findAll(userId);
    return { message: 'Notification preferences retrieved successfully', data };
  }

  @Get('channel/:channel')
  @ApiOperation({ summary: 'Get preferences for a specific channel' })
  @ApiOkResponse({ description: 'Channel preferences retrieved' })
  async findByChannel(
    @GetCurrentUser('id') userId: string,
    @Param('channel') channel: NotificationChannel,
  ) {
    const data = await this.preferencesService.findByChannel(userId, channel);
    return {
      message: 'Channel preferences retrieved successfully',
      data,
    };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a notification preference' })
  @ApiOkResponse({ description: 'Preference updated' })
  async upsert(
    @GetCurrentUser('id') userId: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    const data = await this.preferencesService.upsert(userId, dto);
    return { message: 'Notification preference updated successfully', data };
  }
}
