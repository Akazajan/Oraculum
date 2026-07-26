import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { WebhookHistoryService } from './webhook-history.service';
import { WebhookDeliveryQueryDto } from './dto/webhook-delivery-query.dto';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('webhook-history')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.STAFF)
@Controller('webhook-history')
export class WebhookHistoryController {
  constructor(private readonly webhookHistoryService: WebhookHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook delivery history (admin only)' })
  @ApiOkResponse({ description: 'Delivery history retrieved' })
  async findAll(@Query() query: WebhookDeliveryQueryDto) {
    const result = await this.webhookHistoryService.findAll(query);
    return {
      message: 'Webhook delivery history retrieved successfully',
      ...result,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get webhook delivery details by ID' })
  @ApiOkResponse({ description: 'Delivery details retrieved' })
  @ApiNotFoundResponse({
    description: 'Delivery not found',
    type: ApiErrorDto,
  })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const delivery = await this.webhookHistoryService.findById(id);
    return {
      message: 'Webhook delivery retrieved successfully',
      data: delivery,
    };
  }
}
