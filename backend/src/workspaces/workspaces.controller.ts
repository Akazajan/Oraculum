import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceQueryDto } from './dto/workspace-query.dto';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorators';
import { UserRole } from '../users/enums/userRoles.enum';
import { Public } from '../auth/decorators/public.decorator';
import { GetCurrentUser } from '../auth/decorators/getCurrentUser.decorator';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { Workspace } from './entities/workspace.entity';
import { Logger } from '@nestjs/common';

@ApiTags('workspaces')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({
  description: 'JWT missing or invalid',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Insufficient role', type: ApiErrorDto })
@ApiNotFoundResponse({ description: 'Workspace not found', type: ApiErrorDto })
@Controller('workspaces')
export class WorkspacesController {
  private readonly logger = new Logger(WorkspacesController.name);

  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new workspace (Admin only)' })
  @ApiOkResponse({ description: 'Workspace created', type: Workspace })
  @ApiBadRequestResponse({ description: 'Validation error', type: ApiErrorDto })
  async create(
    @Body() dto: CreateWorkspaceDto,
    @GetCurrentUser('id') _actorId: string,
  ) {
    const workspace = await this.workspacesService.create(dto);
    this.logger.log(`Workspace ${workspace.id} created`);
    return { message: 'Workspace created successfully', data: workspace };
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'List active workspaces' })
  async findAll(@Query() query: WorkspaceQueryDto) {
    const result = await this.workspacesService.findAll(query, false, false);
    return { message: 'Workspaces retrieved successfully', ...result };
  }

  @Get('admin/all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.STAFF)
  @ApiOperation({ summary: 'List all workspaces including inactive (Admin)' })
  async findAllAdmin(@Query() query: WorkspaceQueryDto) {
    const result = await this.workspacesService.findAll(query, true, false);
    return { message: 'Workspaces retrieved successfully', ...result };
  }

  @Get('admin/deleted')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List soft-deleted workspaces (Admin)' })
  async listDeleted(@Query() query: WorkspaceQueryDto) {
    const result = await this.workspacesService.findAll(query, true, true);
    // Filter to only deleted rows for clarity in the admin surface.
    const filtered = result.data.filter((w) => !!w.deletedAt);
    return {
      message: 'Deleted workspaces retrieved successfully',
      data: filtered,
      total: filtered.length,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get workspace by ID' })
  @ApiOkResponse({ description: 'Workspace retrieved', type: Workspace })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const workspace = await this.workspacesService.findById(id);
    return { message: 'Workspace retrieved successfully', data: workspace };
  }

  @Get(':id/availability')
  @Public()
  @ApiOperation({ summary: 'Check workspace seat availability' })
  @ApiQuery({ name: 'seats', required: false, type: Number })
  async checkAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('seats') seats?: number,
  ) {
    const result = await this.workspacesService.checkAvailability(
      id,
      seats ? Number(seats) : 1,
    );
    return { message: 'Availability checked', data: result };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.STAFF)
  @ApiOperation({ summary: 'Update workspace (Admin/Staff)' })
  @ApiOkResponse({ description: 'Workspace updated', type: Workspace })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    const workspace = await this.workspacesService.update(id, dto);
    return { message: 'Workspace updated successfully', data: workspace };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete workspace (Admin only)' })
  @ApiOkResponse({ description: 'Workspace soft-deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.workspacesService.softDelete(id);
    return { message: 'Workspace deleted successfully' };
  }
}
