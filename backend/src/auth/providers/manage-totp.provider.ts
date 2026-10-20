import {
  Injectable,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../../users/entities/user.entity';
import { HashingProvider } from './hashing.provider';
import { Disable2faDto } from '../dto/disable-2fa.dto';
import {
  AuditAction,
  AuditService,
} from '../../audit/audit.service';

/**
 * Backup-code generation policy. Eight plain codes, bcrypt-hashed
 * before storage, surfaced as one-shot consumption tokens. The same
 * policy is reused by SetupTotpProvider and the regeneration flow
 * below so the rules cannot drift between the two.
 */
export const BACKUP_CODE_COUNT = 8;
export const BACKUP_CODE_BYTE_LENGTH = 5;

export async function generateAndHashBackupCodes(): Promise<{
  plain: string[];
  hashed: string[];
}> {
  const plain = Array.from({ length: BACKUP_CODE_COUNT }, () =>
    crypto.randomBytes(BACKUP_CODE_BYTE_LENGTH).toString('hex'),
  );
  const hashed = await Promise.all(plain.map((c) => bcrypt.hash(c, 10)));
  return { plain, hashed };
}

@Injectable()
export class ManageTotpProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly hashingProvider: HashingProvider,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async disable2fa(userId: string, dto: Disable2faDto) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const passwordValid = await this.hashingProvider.compare(
      dto.password,
      user.password,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    user.twoFactorEnabled = false;
    user.totpSecret = null;
    user.totpPendingSecret = null;
    user.totpBackupCodes = null;
    user.totpSecret = null as unknown as undefined;
    user.totpBackupCodes = null as unknown as undefined;
    await this.usersRepository.save(user);

    return { message: '2FA has been disabled' };
  }

  async get2faStatus(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    return {
      enabled: user.twoFactorEnabled,
      backupCodesRemaining: user.totpBackupCodes?.length ?? 0,
    };
  }

  /**
   * BE-06 / BE-13 — Issue a fresh set of backup codes and discard the old ones.
   *
   * The caller MUST already be authenticated AND must re-supply their
   * current password. Previous codes stop working immediately after save.
   * An audit event records the actor and action without any code values.
   */
  async regenerateBackupCodes(
    userId: string,
    password: string,
  ): Promise<{ backupCodes: string[]; backupCodesRemaining: number }> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const passwordValid = await this.hashingProvider.compare(
      password,
      user.password,
    );
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    if (!user.twoFactorEnabled) {
      throw new UnauthorizedException(
        '2FA is not enabled — backup codes cannot be issued',
      );
    }

    const previousCount = user.totpBackupCodes?.length ?? 0;
    const { plain, hashed } = await generateAndHashBackupCodes();
    user.totpBackupCodes = hashed;
    // Bump generation so in-flight consumers of the previous set fail.
    user.backupCodeGeneration = (user.backupCodeGeneration ?? 0) + 1;
    await this.usersRepository.save(user);

    if (this.auditService) {
      await this.auditService.log({
        action: AuditAction.BACKUP_CODES_REGENERATED,
        outcome: 'SUCCESS',
        actor: { id: user.id, email: user.email, role: user.role },
        resourceType: 'user',
        resourceId: user.id,
        metadata: {
          // Never include code values — only counts.
          previousCount,
          issuedCount: hashed.length,
          generation: user.backupCodeGeneration,
        },
      });
    }

    return {
      backupCodes: plain,
      backupCodesRemaining: hashed.length,
    };
  }

  /**
   * BE-12 — Atomically consume a single backup code.
   *
   * Uses a compare-and-swap on the hashed-codes array so concurrent requests
   * presenting the same code cannot both succeed: only the first writer that
   * removes the matching hash wins; the loser re-reads and fails.
   *
   * Unknown, expired (empty set), and already-consumed codes all fail and
   * emit a failure audit event without recording the presented code value.
   */
  async consumeBackupCode(
    userId: string,
    plainCode: string,
  ): Promise<{ backupCodesRemaining: number }> {
    if (!plainCode || typeof plainCode !== 'string') {
      await this.auditBackupFailure(userId, 'missing_code');
      throw new UnauthorizedException('Invalid backup code');
    }

    // Up to a few CAS attempts under concurrency.
    for (let attempt = 0; attempt < 5; attempt++) {
      const user = await this.usersRepository.findOne({
        where: { id: userId },
      });
      if (!user || !user.totpBackupCodes?.length) {
        await this.auditBackupFailure(userId, 'no_codes');
        throw new UnauthorizedException(
          'User not found or no backup codes available',
        );
      }

      const codes = [...user.totpBackupCodes];
      const generation = user.backupCodeGeneration ?? 0;

      let matchedIndex = -1;
      for (let i = 0; i < codes.length; i++) {
        if (await bcrypt.compare(plainCode, codes[i])) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        await this.auditBackupFailure(userId, 'unknown_or_replayed');
        throw new UnauthorizedException('Invalid backup code');
      }

      const next = codes.filter((_, i) => i !== matchedIndex);

      // Optimistic write: only succeed if the stored array still matches
      // the snapshot we read (same generation + same length).
      const result = await this.usersRepository
        .createQueryBuilder()
        .update(User)
        .set({
          totpBackupCodes: next,
        })
        .where('id = :id', { id: userId })
        .andWhere(
          `(backup_code_generation = :generation OR backup_code_generation IS NULL)`,
          { generation },
        )
        .andWhere(`jsonb_array_length(COALESCE("totpBackupCodes", '[]'::jsonb)) = :len`, {
          len: codes.length,
        })
        .execute();

      if ((result.affected ?? 0) === 1) {
        if (this.auditService) {
          await this.auditService.log({
            action: AuditAction.BACKUP_CODE_CONSUMED,
            outcome: 'SUCCESS',
            actor: { id: user.id, email: user.email, role: user.role },
            resourceType: 'user',
            resourceId: user.id,
            metadata: {
              remaining: next.length,
              generation,
            },
          });
        }
        return { backupCodesRemaining: next.length };
      }
      // Lost the race — retry.
    }

    await this.auditBackupFailure(userId, 'concurrent_conflict');
    throw new UnauthorizedException('Invalid backup code');
  }

  private async auditBackupFailure(userId: string, reason: string) {
    if (!this.auditService) return;
    await this.auditService.log({
      action: AuditAction.BACKUP_CODE_FAILED,
      outcome: 'FAILURE',
      actor: { id: userId },
      resourceType: 'user',
      resourceId: userId,
      metadata: { reason },
    });
  }
}
