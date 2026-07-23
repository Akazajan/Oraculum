import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { UserRole } from '../../users/enums/userRoles.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  PaginationDto,
  paginatedResponse,
} from '../../common/dto/pagination.dto';

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
