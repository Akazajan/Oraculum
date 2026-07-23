import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { ErrorCatch } from '../../utils/error';
import { createHash } from 'crypto';
import { HashingProvider } from 'src/auth/providers/hashing.provider';
import { RefreshTokenRepositoryOperations } from 'src/auth/providers/refreshToken.repository';
import { EmailService } from '../../email/email.service';

@Injectable()
export class ResetPasswordProvider {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly hashingProvider: HashingProvider,

    private readonly refreshTokenRepositoryOperations: RefreshTokenRepositoryOperations,

    private readonly emailService: EmailService,
  ) {}

  async execute(rawToken: string, newPassword: string) {
    try {
      if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
        // Tokens are 64 hex chars (32 bytes). Reject obviously-bogus input
        // up-front so we don't waste a DB round-trip on garbage attempts.
        throw new UnauthorizedException('Invalid reset token');
      }

      const hashedToken = createHash('sha256').update(rawToken).digest('hex');
      const now = new Date();

      // Step 1: read-only lookup so we can return an actionable, specific
      // error (expired vs invalid) without modifying state. This is purely
      // for the user-facing error message; it does NOT gate the reset.
      const owner = await this.usersRepository.findOne({
        where: { passwordResetToken: hashedToken },
      });
      if (!owner) {
        // Identical wording to the zero-affected branch so callers cannot
        // distinguish between a missing and an already-consumed token.
        throw new UnauthorizedException(
          'Invalid or expired reset token',
        );
      }
      if (
        !owner.passwordResetExpiresIn ||
        owner.passwordResetExpiresIn < now
      ) {
        // UnauthorizedException (not BadRequest) keeps the public response
        // shape consistent with the "invalid/already-used" branch so
        // leakage across categories is avoided.
        throw new UnauthorizedException('Reset token has expired');
      }

      // Step 2: atomic conditional UPDATE that consumes the token in a
      // single SQL statement. The where-clause re-asserts every condition
      // (token, not-yet-expired), so even two concurrent calls of the same
      // valid token race-safely produce exactly one winner. The
      // affected-rows count is the source of truth for "consumed".
      const hashedPassword = await this.hashingProvider.hash(newPassword);
      const updateResult = await this.usersRepository.update(
        {
          id: owner.id,
          passwordResetToken: hashedToken,
          passwordResetExpiresIn: MoreThan(now),
        },
        {
          password: hashedPassword,
          passwordResetToken: null,
          passwordResetExpiresIn: null,
        },
      );

      if (!updateResult.affected || updateResult.affected === 0) {
        // Lost the race with another concurrent reset attempt.
        throw new UnauthorizedException(
          'Invalid or already-used reset token',
        );
      }

      // Step 3: best-effort post-reset cleanup. A failure here MUST NOT
      // undo the password change — the reset itself already succeeded.
      await this.runPostResetCleanup(owner.id, owner.email, owner.firstname, owner.lastname);

      return { message: 'Password reset successful' };
    } catch (error) {
      ErrorCatch(error, 'Failed to reset password');
    }
  }

  private async runPostResetCleanup(
    userId: string,
    email: string,
    firstname: string,
    lastname: string,
  ): Promise<void> {
    try {
      await this.refreshTokenRepositoryOperations.revokeAllRefreshTokens(
        userId,
      );
    } catch {
      // Session revocation failure is non-fatal after a successful reset.
    }

    try {
      const fullName = `${firstname} ${lastname}`.trim();
      await this.emailService.sendPasswordResetSuccessEmail(
        email,
        fullName || email,
      );
    } catch {
      // Success-email failure is non-fatal after a successful reset.
    }
  }
}
