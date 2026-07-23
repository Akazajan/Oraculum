import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Repository } from 'typeorm';
import { ErrorCatch } from '../../utils/error';

/**
 * BE-14 — `getUsers()` defaults to excluding soft-deleted users so
 * public-facing counts and listings remain correct. Admins can opt
 * into tombstones by passing `withDeleted: true` (used by the admin
 * delete-management surface).
 */
@Injectable()
export class FindAllUsersProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async getUsers(withDeleted = false): Promise<User[]> {
    try {
      return await this.usersRepository.find({
        withDeleted,
      });
    } catch (error) {
      ErrorCatch(error, 'Error fetching users');
    }
  }
}
