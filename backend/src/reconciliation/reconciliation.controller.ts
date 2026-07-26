import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../auth/decorators/roles.decorators';
import { RolesGuard } from '../auth/guard/roles.guard';
import { UserRole } from '../users/enums/userRoles.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { paginatedResponse } from '../common/dto/pagination.dto';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationReport } from './entities/reconciliation-report.entity';
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto';

@ApiTags('reconciliation')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly reconciliationService: ReconciliationService,
    @InjectRepository(ReconciliationReport)
    private readonly reportsRepo: Repository<ReconciliationReport>,
  ) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger reconciliation run (Admin only)' })
  @ApiOkResponse({ description: 'Reconciliation complete' })
  async run() {
    const result = await this.reconciliationService.reconcile();
    return { message: 'Reconciliation complete', data: result };
  }

  @Get('reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List reconciliation reports (Admin only)' })
  @ApiOkResponse({ description: 'Reports retrieved' })
  async list(@Query() query: ReconciliationQueryDto) {
    const { page, limit, invoiceId, outcome, fromDate, toDate } = query;

    const qb = this.reportsRepo.createQueryBuilder('r');

    if (invoiceId) qb.andWhere('r.invoiceId = :invoiceId', { invoiceId });
    if (outcome) qb.andWhere('r.outcome = :outcome', { outcome });
    if (fromDate) qb.andWhere('r.createdAt >= :fromDate', { fromDate: new Date(fromDate) });
    if (toDate) qb.andWhere('r.createdAt <= :toDate', { toDate: new Date(toDate) });

    qb.orderBy('r.createdAt', 'DESC');
    const total = await qb.getCount();
    const items = await qb.skip((page - 1) * limit).take(limit).getMany();

    return paginatedResponse(
      'Reconciliation reports retrieved successfully',
      items,
      total,
      page,
      limit,
    );
  }
}
