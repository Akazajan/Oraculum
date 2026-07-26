import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';
import { UseGuards as UseAuthGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorators';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';

@ApiTags('webhooks')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @ApiOperation({ summary: 'Create a webhook' })
  @ApiCreatedResponse({ description: 'Webhook created' })
  async create(@Body() dto: CreateWebhookDto) {
    const webhook = await this.webhookService.createWebhook(dto);
    return { message: 'Webhook created', webhook };
  }

  @Get()
  @ApiOperation({ summary: 'List all webhooks' })
  @ApiOkResponse({ description: 'Webhooks retrieved' })
  async findAll() {
    const webhooks = await this.webhookService.findAllWebhooks();
    return { message: 'Webhooks retrieved', webhooks };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a webhook by ID' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const webhook = await this.webhookService.findWebhookById(id);
    return { message: 'Webhook retrieved', webhook };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a webhook' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const webhook = await this.webhookService.updateWebhook(id, dto);
    return { message: 'Webhook updated', webhook };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.webhookService.deleteWebhook(id);
  }
}
