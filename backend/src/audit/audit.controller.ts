import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditQueryDto } from './dto/audit-query.dto';
import { paginatedResponse } from '../common/dto/pagination.dto';

/**
 * BE-03 — Admin retrieval endpoint for the audit log.
 *
 * Restricted to ADMIN / SUPER_ADMIN via `RolesGuard`. Always returns a
 * stable paginated payload so it can be safely consumed from the
 * operator dashboard or scripted exports.
 */
@ApiTags('audit')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/audit-log')
export class AuditController {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List audit-log entries (Admin only)' })
  async list(@Query() query: AuditQueryDto) {
    const { page, limit, action, outcome, actorEmail, actorId, resourceType, resourceId, fromDate, toDate, search } = query;

    const qb = this.auditRepository.createQueryBuilder('a');

    if (action) qb.andWhere('a.action = :action', { action });
    if (outcome) qb.andWhere('a.outcome = :outcome', { outcome });
    if (actorEmail) qb.andWhere('LOWER(a.actorEmail) = :email', { email: actorEmail.toLowerCase() });
    if (actorId) qb.andWhere('a.actorId = :actorId', { actorId });
    if (resourceType)
      qb.andWhere('a.resourceType = :resourceType', { resourceType });
    if (resourceId)
      qb.andWhere('a.resourceId = :resourceId', { resourceId });
    if (fromDate)
      qb.andWhere('a.createdAt >= :fromDate', { fromDate: new Date(fromDate) });
    if (toDate) qb.andWhere('a.createdAt <= :toDate', { toDate: new Date(toDate) });
    if (search) {
      qb.andWhere(
        '(LOWER(a.action) LIKE :search OR LOWER(a.actorEmail) LIKE :search OR CAST(a.metadata AS TEXT) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    qb.orderBy('a.createdAt', 'DESC');

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return paginatedResponse(
      'Audit log retrieved successfully',
      items,
      total,
      page,
      limit,
    );
  }
}
