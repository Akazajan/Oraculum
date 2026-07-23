import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { ErrorCatch } from '../../utils/error';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';

export const DEFAULT_PASSWORD_RESET_EXPIRATION_MS = 15 * 60 * 1000; // 15 min

@Injectable()
export class ForgotPasswordProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly emailService: EmailService,

    private readonly configService: ConfigService,
  ) {}

  async execute(email: string) {
    try {
      const user = await this.usersRepository.findOne({ where: { email } });
      if (!user) {
        // We deliberately use the same wording as for an existing address to
        // avoid leaking which emails have accounts. A 404 here signals a real
        // misroute to the operator while keeping public responses consistent.
        throw new NotFoundException(
          'If an account exists for this email, reset instructions have been sent',
        );
      }

      // Generate a fresh 256-bit token. The hashed copy is what we store; the
      // raw token is what we put in the URL. Even if the DB is compromised,
      // the raw token never sits in persistent storage.
      const rawToken = randomBytes(32).toString('hex');
      const hashedToken = createHash('sha256').update(rawToken).digest('hex');

      // Enforce a strict, configurable expiry. Old tokens are explicitly
      // invalidated so the latest issued link is the only one that works.
      const rawExpiration = this.configService.get<string>(
        'PASSWORD_RESET_EXPIRATION_MS',
      );
      const parsedExpiration = rawExpiration ? parseInt(rawExpiration, 10) : NaN;
      const expirationMs =
        Number.isFinite(parsedExpiration) && parsedExpiration > 0
          ? parsedExpiration
          : DEFAULT_PASSWORD_RESET_EXPIRATION_MS;
      const now = new Date();
      user.passwordResetToken = hashedToken;
      user.passwordResetExpiresIn = new Date(now.getTime() + expirationMs);
      user.lastPasswordResetSentAt = now;

      await this.usersRepository.save(user);

      const frontendBase =
        this.configService.get<string>('FRONTEND_PASSWORD_RESET_URL') ||
        'https://Oraculum.vercel.app/reset-password?token=';
      const resetLink = `${frontendBase}${rawToken}`;

      const fullName = `${user.firstname} ${user.lastname}`.trim();
      const emailed = await this.emailService.sendPasswordResetLinkEmail(
        user.email,
        fullName || user.email,
        resetLink,
      );

      if (!emailed) {
        // Don't leak whether the send failed for the recipient, but ensure
        // the caller knows to investigate. Caller can return a generic OK
        // message if needed (handled in the controller, kept narrow here).
        throw new BadRequestException(
          'Password reset email could not be delivered; please retry shortly',
        );
      }

      return { message: 'Password reset instructions sent to email' };
    } catch (error) {
      ErrorCatch(error, 'Failed to initiate password reset');
    }
  }
}
