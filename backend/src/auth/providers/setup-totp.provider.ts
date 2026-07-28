import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { generateSecret, generateURI } from 'otplib';
import * as QRCode from 'qrcode';
import { User } from '../../users/entities/user.entity';
import { Setup2faDto } from '../dto/setup-2fa.dto';
import { verifySync } from 'otplib';
import {
  generateAndHashBackupCodes,
} from './manage-totp.provider';

@Injectable()
export class SetupTotpProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async initiate2faSetup(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const secret = generateSecret();
    user.totpSecret = secret;
    await this.usersRepository.save(user);

    const otpauth = generateURI({
      issuer: 'Oraculum',
      label: user.email,
      secret,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    return { secret, qrCodeDataUrl };
  }

  /**
   * BE-06 — Finalise 2FA enrollment and hand the user their first
   * batch of recovery codes. The hash policy is shared with the
   * regeneration path via `generateAndHashBackupCodes` so the rules
   * (count, entropy, bcrypt cost) cannot drift apart.
   */
  async confirm2faSetup(userId: string, dto: Setup2faDto) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.totpSecret) {
      throw new UnauthorizedException('2FA setup not initiated');
    }

    const result = verifySync({ token: dto.token, secret: user.totpSecret });
    if (!result?.valid) {
      throw new UnauthorizedException('Invalid TOTP code');
    }

    const { plain, hashed } = await generateAndHashBackupCodes();

    user.twoFactorEnabled = true;
    user.totpBackupCodes = hashed;
    await this.usersRepository.save(user);

    return { backupCodes: plain };
  }
}
