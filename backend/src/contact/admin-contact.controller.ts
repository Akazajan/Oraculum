import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ContactService } from './contact.service';

/**
 * BE-14 — Admin endpoints for managing contact-form messages:
 *
 * - GET   /api/admin/contact        List messages
 * - GET   /api/admin/contact/deleted  List soft-deleted messages
 * - PATCH /api/admin/contact/:id/read   Mark a message as read
 * - DELETE /api/admin/contact/:id       Soft-delete a message
 * - PATCH /api/admin/contact/:id/restore Restore a message
 *
 * Restricted to ADMIN / SUPER_ADMIN / STAFF via `RolesGuard`.
 */
@ApiTags('admin')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.STAFF)
@Controller('admin/contact')
export class AdminContactController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List contact messages (Admin/Staff)' })
  async list() {
    const items = await this.contactService.listMessages();
    return { message: 'Messages retrieved', data: items };
  }

  @Get('deleted')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List soft-deleted contact messages (Admin/Staff)' })
  async listDeleted() {
    const items = await this.contactService.listDeleted();
    return { message: 'Deleted messages retrieved', data: items };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a contact message as read' })
  async markRead(@Param('id', ParseUUIDPipe) id: string) {
    const updated = await this.contactService.markRead(id);
    return { message: 'Message marked as read', data: updated };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a contact message (Admin)' })
  async softDelete(@Param('id', ParseUUIDPipe) id: string) {
    await this.contactService.softDelete(id);
    return { message: 'Message soft-deleted' };
  }

  @Patch(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted contact message (Admin)' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    const restored = await this.contactService.restore(id);
    return { message: 'Message restored', data: restored };
  }
}
