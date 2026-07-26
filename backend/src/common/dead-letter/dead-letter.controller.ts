import {
  Controller,
  Get,
  Param,
  Delete,
  Patch,
  Query,
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
  ApiQuery,
} from '@nestjs/swagger';
import { DeadLetterService } from './dead-letter.service';
import { UseGuards as UseAuthGuards } from '@nestjs/common';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorators';
import { UserRole } from '../../users/enums/userRoles.enum';
import { ApiErrorDto } from '../dto/api-error.dto';

@ApiTags('dead-letter')
@ApiBearerAuth('bearer')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('dead-letter')
export class DeadLetterController {
  constructor(private readonly deadLetterService: DeadLetterService) {}

  @Get()
  @ApiOperation({ summary: 'List dead-letter jobs' })
  @ApiQuery({ name: 'queueName', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async findAll(
    @Query('queueName') queueName?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.deadLetterService.findAll({
      queueName,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return { message: 'Dead-letter jobs retrieved', ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a dead-letter job by ID' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const job = await this.deadLetterService.findById(id);
    return { message: 'Dead-letter job retrieved', job };
  }

  @Patch(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a dead-letter job as retried' })
  async markRetried(@Param('id', ParseUUIDPipe) id: string) {
    await this.deadLetterService.markRetried(id);
    return { message: 'Dead-letter job marked as retried' };
  }

  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a dead-letter job as resolved' })
  async markResolved(@Param('id', ParseUUIDPipe) id: string) {
    await this.deadLetterService.markResolved(id);
    return { message: 'Dead-letter job marked as resolved' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dead-letter job' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.deadLetterService.remove(id);
  }
}
