import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '../../users/entities/user.entity';
import { HashingProvider } from './hashing.provider';
import { Disable2faDto } from '../dto/disable-2fa.dto';

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
    user.totpBackupCodes = null;
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
   * BE-06 — Issue a fresh set of backup codes and discard the old ones.
   *
   * The caller MUST already be authenticated (`JwtAuthGuard` on the
   * route returns the verified user id) AND must re-supply their
   * current password (the DTO contract from `RegenerateBackupCodesDto`)
   * to prove ownership even if the access token has been hijacked.
   * The previous codes will no longer be accepted after this call
   * returns, so any client holding an old code must capture the new
   * ones from the response before continuing.
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

    const { plain, hashed } = await generateAndHashBackupCodes();
    user.totpBackupCodes = hashed;
    await this.usersRepository.save(user);

    return {
      backupCodes: plain,
      backupCodesRemaining: hashed.length,
    };
  }
}
