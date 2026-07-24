import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ErrorCatch } from '../../utils/error';

/**
 * BE-14 — Default lookup excludes soft-deleted users. Admin callers
 * can opt into seeing deleted users by passing `withDeleted: true`
 * via `findByIdKeepSoftDeleted()` so the audit / restore surface
 * stays usable without exposing tombstones to regular endpoints.
 */
@Injectable()
export class FindOneUserByIdProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  public async getUser(id: string, withDeleted = false): Promise<User> {
    try {
      const where: FindOptionsWhere<User> = { id };
      const user = await this.usersRepository.findOne({
        where,
        withDeleted,
      });

      if (!user) {
        throw new UnauthorizedException('Credentials are not valid');
      }

      return user;
    } catch (error) {
      ErrorCatch(error, 'Error retrieving user details');
    }
  }
}
