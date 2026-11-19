import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { User } from '../../users/entities/user.entity';
import { Setup2faDto } from '../dto/setup-2fa.dto';
import { generateAndHashBackupCodes } from './manage-totp.provider';

/**
 * BE-11 — Require 2FA confirmation before enabling it.
 * `initiate2faSetup` only stores a *pending* secret; `twoFactorEnabled`
 * flips to true only after a valid TOTP confirms possession.
 */
@Injectable()
export class SetupTotpProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /** Alias used by auth.service.setup2fa */
  async setup(user: User, _dto?: Setup2faDto) {
    return this.initiate2faSetup(user.id);
  }

  async initiate2faSetup(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const secret = generateSecret();
    // Do NOT activate 2FA or replace the live secret until confirmation.
    user.totpPendingSecret = secret;
    // Keep twoFactorEnabled unchanged (false for new enrollments).
    await this.usersRepository.save(user);

    const otpauth = generateURI({
      issuer: 'Oraculum',
      label: user.email,
      secret,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    return {
      secret,
      qrCodeDataUrl,
      twoFactorEnabled: user.twoFactorEnabled === true,
    };
  }

  /**
   * Finalise enrollment: valid TOTP promotes pending → active secret and
   * enables 2FA. Invalid code leaves 2FA disabled and pending intact for retry.
   */
  async confirm2faSetup(userId: string, dto: Setup2faDto) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.totpPendingSecret) {
      throw new UnauthorizedException('2FA setup not initiated');
    }

    const result = verifySync({
      token: dto.token,
      secret: user.totpPendingSecret,
    });
    if (!result?.valid) {
      // Leave twoFactorEnabled false; do not clear pending so user can retry.
      throw new UnauthorizedException('Invalid TOTP code');
    }

    const { plain, hashed } = await generateAndHashBackupCodes();

    user.totpSecret = user.totpPendingSecret;
    user.totpPendingSecret = null as unknown as undefined;
    user.twoFactorEnabled = true;
    user.totpBackupCodes = hashed;
    await this.usersRepository.save(user);

    return { backupCodes: plain, twoFactorEnabled: true };
  }
}
