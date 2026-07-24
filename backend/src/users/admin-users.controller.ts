import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsersService } from './providers/users.service';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from './enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { paginatedResponse } from '../common/dto/pagination.dto';
import { MemberQueryDto } from './dto/member-query.dto';

/**
 * BE-14 — Admin endpoint for managing soft-deleted user accounts.
 *
 * - GET    /api/admin/users                Includes deleted by default
 * - GET    /api/admin/users/deleted        Only deleted
 * - PATCH  /api/admin/users/:id/restore    Restore a soft-deleted user
 *
 * Restricted to ADMIN / SUPER_ADMIN via `RolesGuard`.
 */
@ApiTags('admin')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List users, including soft-deleted (Admin)' })
  @ApiOkResponse({ description: 'Users list' })
  async list(@Query() query: MemberQueryDto) {
    const { page = 1, limit = 20, status, search } = query;

    const items = await this.usersService.getMembers(
      { page, limit, status, search } as MemberQueryDto,
      true,
    );
    return paginatedResponse(
      'Users retrieved successfully',
      items.data,
      items.total,
      page,
      limit,
    );
  }

  @Get('deleted')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List soft-deleted users only (Admin)' })
  async listDeleted(@Query() query: MemberQueryDto) {
    const { page = 1, limit = 20 } = query;
    const items = await this.usersService.findAllUsersIncludingDeleted();
    const deleted = items.filter((u) => !!u.deletedAt);
    const slice = deleted.slice((page - 1) * limit, page * limit);
    return paginatedResponse(
      'Soft-deleted users retrieved',
      slice.map(({ password: _password, ...rest }) => rest),
      deleted.length,
      page,
      limit,
    );
  }

  @Patch(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted user (Admin)' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    const restored = await this.usersService.restoreUser(id);
    const { password: _ignored, ...safe } = restored;
    return {
      message: 'User restored successfully',
      data: safe,
    };
  }
}
