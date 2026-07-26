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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { PaymentFailureQueryDto } from './dto/payment-failure-query.dto';
import { paginatedResponse } from '../common/dto/pagination.dto';
import { AuditAction } from '../audit/audit.service';

@ApiTags('payments')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('payments/failure-logs')
export class PaymentFailureLogsController {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List payment failure logs (Staff/Admin only)' })
  async list(@Query() query: PaymentFailureQueryDto) {
    const { page, limit, userId, paymentId, provider, fromDate, toDate, search } = query;

    const qb = this.auditRepository.createQueryBuilder('a');
    qb.andWhere('a.action = :action', { action: AuditAction.PAYMENT_FAILED });

    if (userId) qb.andWhere('a.actorId = :userId', { userId });
    if (paymentId) qb.andWhere('a.resourceId = :paymentId', { paymentId });
    if (provider) qb.andWhere("a.metadata->>'provider' = :provider", { provider });
    if (fromDate) qb.andWhere('a.createdAt >= :fromDate', { fromDate: new Date(fromDate) });
    if (toDate) qb.andWhere('a.createdAt <= :toDate', { toDate: new Date(toDate) });
    if (search) {
      qb.andWhere(
        `(a.metadata->>'paymentReference' ILIKE :search
          OR a.metadata->>'errorCode' ILIKE :search
          OR a.metadata->>'errorMessage' ILIKE :search
          OR CAST(a.metadata AS TEXT) ILIKE :search)`,
        { search: `%${search}%` },
      );
    }

    qb.orderBy('a.createdAt', 'DESC');
    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();

    return paginatedResponse('Payment failure logs retrieved successfully', items, total, page, limit);
  }
}
