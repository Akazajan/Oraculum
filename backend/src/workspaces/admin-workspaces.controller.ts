import {
  Controller,
  Patch,
  Param,
  ParseUUIDPipe,
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
import { WorkspacesService } from './workspaces.service';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';

/**
 * BE-14 — Admin endpoint for restoring a soft-deleted workspace.
 *
 * - PATCH /api/admin/workspaces/:id/restore — clears `deletedAt` and
 *   flips `isActive` back to true. Emits a `WORKSPACE_RESTORED` audit
 *   row so administrators can trace who undid a soft-delete.
 *
 * Restricted to ADMIN / SUPER_ADMIN via `RolesGuard`.
 */
@ApiTags('admin')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/workspaces')
export class AdminWorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Patch(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted workspace (Admin)' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    await this.workspacesService.restore(id);
    const workspace = await this.workspacesService.findById(id, {
      withDeleted: true,
    });
    return { message: 'Workspace restored successfully', data: workspace };
  }
}
