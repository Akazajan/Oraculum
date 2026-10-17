import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { PaymentStatus } from '../enums/payment-status.enum';
import { UserRole } from '../../users/enums/userRoles.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  PaginationDto,
  paginatedResponse,
} from '../../common/dto/pagination.dto';
import { DateRangeConstraint } from '../dto/payment-failure-query.dto';

export const MAX_PAGE = 10_000;

/** A date-only toDate ("2026-07-31") should include that whole day. */
function endOfRange(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
}

/**
 * Query parameters for listing payments (BE-15 acceptance).
 *
 * Extends the unified `PaginationDto` so defaults (page=1,
 * limit=20, max=100) and validation messages are identical
 * across every list endpoint.
 */
export class PaymentQuery extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by booking UUID' })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiPropertyOptional({
    default: DEFAULT_PAGE,
    minimum: 1,
    maximum: MAX_PAGE,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be greater than or equal to 1' })
  @Max(MAX_PAGE, { message: `page must be less than or equal to ${MAX_PAGE}` })
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  @Validate(DateRangeConstraint)
  toDate?: string;
}

@Injectable()
export class FindPaymentsProvider {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
  ) {}

  async findAll(
    query: PaymentQuery,
    requestingUserId: string,
    requestingUserRole: UserRole,
  ) {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const isAdmin =
      requestingUserRole === UserRole.ADMIN ||
      requestingUserRole === UserRole.SUPER_ADMIN ||
      requestingUserRole === UserRole.STAFF;

    const qb = this.paymentsRepository.createQueryBuilder('payment');

    if (!isAdmin) {
      qb.where('payment.userId = :userId', { userId: requestingUserId });
    }

    if (query.bookingId) {
      qb.andWhere('payment.bookingId = :bookingId', {
        bookingId: query.bookingId,
      });
    }

    if (query.status) {
      qb.andWhere('payment.status = :status', { status: query.status });
    }

    if (query.fromDate) {
      qb.andWhere('payment.createdAt >= :fromDate', {
        fromDate: new Date(query.fromDate),
      });
    }

    if (query.toDate) {
      qb.andWhere('payment.createdAt <= :toDate', {
        toDate: endOfRange(query.toDate),
      });
    }

    qb.orderBy('payment.createdAt', 'DESC').skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return paginatedResponse(
      'Payments retrieved successfully',
      data,
      total,
      page,
      limit,
    );
  }

  async findById(
    paymentId: string,
    requestingUserId: string,
    requestingUserRole: UserRole,
  ): Promise<Payment | null> {
    const isAdmin =
      requestingUserRole === UserRole.ADMIN ||
      requestingUserRole === UserRole.SUPER_ADMIN ||
      requestingUserRole === UserRole.STAFF;

    const qb = this.paymentsRepository
      .createQueryBuilder('payment')
      .where('payment.id = :id', { id: paymentId });

    if (!isAdmin) {
      qb.andWhere('payment.userId = :userId', { userId: requestingUserId });
    }

    return qb.getOne();
  }
}