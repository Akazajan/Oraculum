import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { ErrorCatch } from '../../utils/error';
import { AuditAction, AuditService } from '../../audit/audit.service';

/**
 * BE-14 — Soft-deletes a user via TypeORM's `repository.softDelete`,
 * which sets the `@DeleteDateColumn()` column rather than removing
 * the row. Audit events are written so the deletion is traceable and
 * an admin can later restore the account (delete-log setting
 * `deletedAt` back to null).
 *
 * The provider also guarantees that `isActive` is flipped to false so
 * any downstream JWT-aware guards that still key off `isActive` will
 * deny access immediately. Restoring the user via the admin endpoint
 * flips it back to true.
 */
@Injectable()
export class DeleteUserProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly auditService: AuditService,
  ) {}

  async deleteUser(id: string): Promise<void> {
    try {
      const existing = await this.usersRepository.findOne({
        where: { id },
        withDeleted: true,
      });
      if (!existing) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Use TypeORM soft-delete (sets deletedAt) rather than removing
      // the row — restores possible, FK relationships intact.
      await this.usersRepository.softDelete(id);

      // Keep `isActive` consistent so legacy guards see the deletion.
      if (existing.isActive) {
        await this.usersRepository.update(id, { isActive: false });
      }

      await this.auditService.adminAction(
        AuditAction.USER_DELETED,
        {
          id: existing.id,
          email: existing.email,
          role: existing.role,
        },
        'User',
        existing.id,
        { previousActive: existing.isActive },
      );
    } catch (error) {
      ErrorCatch(error, 'Failed to delete user');
    }
  }
}
