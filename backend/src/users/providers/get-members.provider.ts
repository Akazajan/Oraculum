import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../entities/user.entity';
import { MemberQueryDto } from '../dto/member-query.dto';

export interface PaginatedMembers {
  data: Partial<User>[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * BE-14 — Members list automatically excludes soft-deleted users
 * because the TypeORM `User` repository uses `@DeleteDateColumn`.
 * The legacy `user.isDeleted = :isDeleted` filter is no longer
 * required; the column is preserved for backward compatibility but
 * not written by service code.
 *
 * Admins can opt into viewing tombstones by passing `withDeleted:
 * true` (the dedicated admin endpoint uses that mode).
 */
@Injectable()
export class GetMembersProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async getMembers(
    query: MemberQueryDto,
    withDeleted = false,
  ): Promise<PaginatedMembers> {
    const { page = 1, limit = 20, status, search } = query;

    const qb: SelectQueryBuilder<User> = this.usersRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.firstname',
        'user.lastname',
        'user.email',
        'user.phone',
        'user.username',
        'user.profilePicture',
        'user.role',
        'user.membershipStatus',
        'user.memberSince',
        'user.profileCompleteness',
        'user.isVerified',
        'user.isActive',
        'user.isSuspended',
        'user.deletedAt',
        'user.createdAt',
      ]);

    // TypeORM's QueryBuilder.withDeleted() toggles the soft-delete
    // filter. The argument-style call is not part of this version of
    // the API, so we conditionally invoke it.
    if (withDeleted) {
      qb.withDeleted();
    }

    qb.where('user.isDeleted = :isDeleted', { isDeleted: false });

    if (withDeleted) {
      // When surfacing tombstones, only show rows whose deletedAt is
      // actually set so the list is meaningful.
      qb.andWhere('user.deletedAt IS NOT NULL');
    }

    if (status) {
      qb.andWhere('user.membershipStatus = :status', { status });
    }

    if (search) {
      qb.andWhere(
        '(LOWER(user.firstname) LIKE :search OR LOWER(user.lastname) LIKE :search OR LOWER(user.email) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    const total = await qb.getCount();
    const data = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('user.createdAt', 'DESC')
      .getMany();

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
