import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { User } from '../users/entities/user.entity';
import { MoreThan, Repository } from 'typeorm';
import { UserHelper } from './helper/user-helper';
import { InjectRepository } from '@nestjs/typeorm';
import { UserMessages } from './helper/user-messages';
import { UserRole } from '../users/enums/userRoles.enum';
import { JwtHelper } from './helper/jwt-helper';
import * as moment from 'moment';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { SendPasswordResetOtpDto } from './dto/send-password-reset-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenRepositoryOperations } from './providers/refreshToken.repository';
import { SetupTotpProvider } from './providers/setup-totp.provider';
import { VerifyTotpProvider } from './providers/verify-totp.provider';
import { ManageTotpProvider } from './providers/manage-totp.provider';
import { Setup2faDto } from './dto/setup-2fa.dto';
import { VerifyTotpDto } from './dto/verify-totp.dto';
import { UseBackupCodeDto } from './dto/use-backup-code.dto';
import { Disable2faDto } from './dto/disable-2fa.dto';
import { AuditAction, AuditService } from '../audit/audit.service';
import { ErrorCatch } from '../utils/error';
import { getCurrentActorFromAls } from '../common/utils/current-actor.util';
import { createHash, timingSafeEqual } from 'node:crypto';

const DEFAULT_PASSWORD_RESET_OT_MINUTES = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function hashVerificationCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function matchesVerificationCode(
  storedHash: string | undefined,
  code: string,
): boolean {
  const expectedHash = Buffer.from(hashVerificationCode(code), 'hex');
  const hasValidHash = /^[a-f0-9]{64}$/i.test(storedHash ?? '');
  const actualHash = hasValidHash
    ? Buffer.from(storedHash!, 'hex')
    : Buffer.alloc(expectedHash.length);

  return timingSafeEqual(expectedHash, actualHash) && hasValidHash;
// BE-17 — Single source of truth for email normalization. Every lookup,
// uniqueness check, and persistence path must funnel through this helper so
// case/whitespace variants resolve to one account.
function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly userHelper: UserHelper,
    private readonly jwtHelper: JwtHelper,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly refreshTokenRepositoryOperations: RefreshTokenRepositoryOperations,
    private readonly setupTotpProvider: SetupTotpProvider,
    private readonly verifyTotpProvider: VerifyTotpProvider,
    private readonly manageTotpProvider: ManageTotpProvider,
    private readonly auditService: AuditService,
  ) {}

  // BE-22 — `findOne({ where: { email } })` already excludes soft-deleted
  // rows thanks to TypeORM's `@DeleteDateColumn` — so anonymous
  // registration attempts against a previously-deleted email fail with
  // EMAIL_ALREADY_EXIST rather than re-onboarding a deleted identity.

  //create user
  async createUser(createUserDto: CreateUserDto) {
    const email = createUserDto.email.trim().toLowerCase();
    const email = normalizeEmail(createUserDto.email);
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      await this.auditService.authFailure(
        AuditAction.REGISTER,
        email,
        { reason: 'email_already_exists' },
      );
      throw new ConflictException(UserMessages.EMAIL_ALREADY_EXIST);
    }

    const validPassword = this.userHelper.isValidPassword(
      createUserDto.password,
    );
    if (!validPassword) {
      await this.auditService.authFailure(
        AuditAction.REGISTER,
        email,
        { reason: 'weak_password' },
      );
      throw new ConflictException(UserMessages.IS_VALID_PASSWORD);
    }
    const hashedPassword = await this.userHelper.hashPassword(
      createUserDto.password,
    );
    const verificationCode = this.userHelper.generateVerificationCode();
    const expiration = moment().add(10, 'minutes').toDate();
    const newUser = this.userRepository.create({
      email,
      firstname: createUserDto.firstname,
      lastname: createUserDto.lastname,
      password: hashedPassword,
      role: UserRole.USER,
      verificationCode: hashVerificationCode(verificationCode),
      verificationCodeExpiresAt: expiration,
      isVerified: false,
    });
    await this.saveUserOrThrowConflict(newUser, AuditAction.REGISTER, email);

    await this.emailService.sendVerificationEmail(
      newUser.email,
      verificationCode,
      `${newUser.firstname} ${newUser.lastname}`,
    );

    await this.auditService.authSuccess(AuditAction.REGISTER, {
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    const accessToken = this.jwtHelper.generateAccessToken(newUser);

    return {
      user: this.userHelper.formatUserResponse(newUser),
      accessToken: accessToken,
    };
  }

  async createAdminUser(createUserDto: CreateUserDto) {
    const email = createUserDto.email.trim().toLowerCase();
    const email = normalizeEmail(createUserDto.email);
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      await this.auditService.authFailure(
        AuditAction.REGISTER_ADMIN,
        email,
        { reason: 'email_already_exists' },
      );
      throw new ConflictException(UserMessages.EMAIL_ALREADY_EXIST);
    }

    const validPassword = this.userHelper.isValidPassword(
      createUserDto.password,
    );
    if (!validPassword) {
      await this.auditService.authFailure(
        AuditAction.REGISTER_ADMIN,
        email,
        { reason: 'weak_password' },
      );
      throw new ConflictException(UserMessages.IS_VALID_PASSWORD);
    }
    const hashedPassword = await this.userHelper.hashPassword(
      createUserDto.password,
    );
    const newUser = this.userRepository.create({
      email,
      firstname: createUserDto.firstname,
      lastname: createUserDto.lastname,
      password: hashedPassword,
      role: UserRole.ADMIN,
    });
    await this.saveUserOrThrowConflict(
      newUser,
      AuditAction.REGISTER_ADMIN,
      email,
    );

    await this.auditService.adminAction(
      AuditAction.REGISTER_ADMIN,
      getCurrentActorFromAls(),
      'User',
      newUser.id,
      { email: newUser.email, role: newUser.role },
    );

    const accessToken = this.jwtHelper.generateAccessToken(newUser);

    return {
      user: this.userHelper.formatUserResponse(newUser),
      accessToken: accessToken,
    };
  }

  private async saveUserOrThrowConflict(
    user: User,
    action: AuditAction,
    email: string,
  ): Promise<void> {
    try {
      await this.userRepository.save(user);
    } catch (error) {
      const dbError = error as {
        code?: string;
        driverError?: { code?: string };
      };
      if (dbError?.code !== '23505' && dbError?.driverError?.code !== '23505') {
        throw error;
      }

      await this.auditService.authFailure(action, email, {
        reason: 'email_already_exists',
      });
      throw new ConflictException(UserMessages.EMAIL_ALREADY_EXIST);
    }
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const { otp } = verifyOtpDto;
    const email = normalizeEmail(verifyOtpDto.email);

    if (!email) {
      throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
    }

    if (!otp) {
      throw new BadRequestException(UserMessages.OTP_REQUIRED);
    }

    const user = await this.userRepository.findOne({ where: { email } });

    if (!user) {
      await this.auditService.authFailure(AuditAction.OTP_FAILED, email);
      throw new UnauthorizedException(UserMessages.USER_NOT_FOUND);
    }

    if (
      !user.verificationCodeExpiresAt ||
      user.verificationCodeExpiresAt < new Date()
    ) {
      await this.auditService.authFailure(
        AuditAction.OTP_FAILED,
        email,
        { reason: 'expired', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.OTP_EXPIRED);
    }

    if (!matchesVerificationCode(user.verificationCode, otp)) {
      await this.auditService.authFailure(
        AuditAction.OTP_FAILED,
        email,
        { reason: 'invalid_code', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.INVALID_OTP);
    }

    user.isVerified = true;
    user.verificationCode = '';
    user.verificationCodeExpiresAt = undefined;

    await this.userRepository.save(user);

    await this.auditService.authSuccess(AuditAction.OTP_VERIFIED, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // BE-04 — Persist the refresh token so the rotation flow (and the
    // logout endpoint) can later invalidate it via DB lookup.
    const tokens = this.jwtHelper.generateTokens(user);
    await this.refreshTokenRepositoryOperations.saveRefreshToken(
      user,
      tokens.refreshToken,
    );

    return {
      message: UserMessages.VERIFY_OTP_SUCCESS,
      user: this.userHelper.formatUserResponse(user),
      tokens: tokens,
    };
  }

  async resendVerificationOtp(email: string) {
    try {
      email = normalizeEmail(email);
      if (!email) {
        throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
      }

      const user = await this.userRepository.findOne({ where: { email } });
      if (!user) {
        throw new NotFoundException(UserMessages.USER_NOT_FOUND);
      }

      const verificationCode = this.userHelper.generateVerificationCode();

      user.verificationCode = hashVerificationCode(verificationCode);
      user.verificationCodeExpiresAt = moment().add(10, 'minutes').toDate();
      await this.userRepository.save(user);

      await this.emailService.sendVerificationEmail(
        user.email,
        verificationCode,
        `${user.firstname} ${user.lastname}`,
      );

      return { message: UserMessages.OTP_SENT };
    } catch (error) {
      // #203 — Re-throw typed HTTP exceptions (e.g. BadRequestException,
      // NotFoundException) unchanged so clients see the real 4xx status;
      // only unexpected failures are normalised to 500.
      ErrorCatch(error, 'Error resending verification code');
    }
  }

  async login(loginUserDto: LoginUserDto) {
    const email = normalizeEmail(loginUserDto.email);
    const user = await this.userRepository.findOne({
      where: { email: loginUserDto.email },
      withDeleted: true,
      where: { email },
    });

    // BE-19 — soft-deleted accounts must not be able to authenticate.
    if (user && user.deletedAt) {
      await this.auditService.authFailure(
        AuditAction.LOGIN_FAILED,
        loginUserDto.email,
        { reason: 'deleted', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.INVALID_CREDENTIALS);
    }

    // B22 — locked accounts are rejected up-front with the exact same
    // response shape as bad credentials (no account probing).
    if (user && user.lockoutUntil && user.lockoutUntil > new Date()) {
      await this.auditService.authFailure(AuditAction.LOGIN_FAILED, email, {
        reason: 'locked',
        userId: user.id,
      });
      throw new UnauthorizedException(UserMessages.INVALID_CREDENTIALS);
    }

    if (
      !user ||
      !(await this.userHelper.verifyPassword(
        loginUserDto.password,
        user.password,
      ))
    ) {
      if (user) {
        await this.bumpLoginFailure(user);
      }
      await this.auditService.authFailure(
        AuditAction.LOGIN_FAILED,
        email,
        { reason: !user ? 'unknown_email' : 'bad_password' },
      );
      throw new UnauthorizedException(UserMessages.INVALID_CREDENTIALS);
    }

    // B22 — a successful authentication resets the failure state.
    if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
      await this.userRepository.update(user.id, {
        failedLoginAttempts: 0,
        lockoutUntil: null,
      });
      user.failedLoginAttempts = 0;
      user.lockoutUntil = null;
    }

    if (!user.isVerified) {
      await this.resendVerificationOtp(email);
      await this.auditService.authFailure(
        AuditAction.LOGIN_FAILED,
        email,
        { reason: 'unverified', userId: user.id },
      );
      return {
        message: UserMessages.EMAIL_NOT_VERIFIED,
        user: this.userHelper.formatUserResponse(user),
      };
    }

    await this.auditService.authSuccess(AuditAction.LOGIN_SUCCESS, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    if (user.twoFactorEnabled) {
      const tempToken = this.jwtHelper.generateTempToken(user.id);
      return { requiresTwoFactor: true, tempToken };
    }

    // BE-04 — Persist the refresh token on login so the rotation flow
    // can later detect reuse. The DB row carries the family UUIFû the
    // JWT carries the same family so we can correlate them.
    const { accessToken, refreshToken } = this.jwtHelper.generateTokens(user);
    await this.refreshTokenRepositoryOperations.saveRefreshToken(
      user,
      refreshToken,
    );
    return {
      user: this.userHelper.formatUserResponse(user),
      accessToken: accessToken,
      refreshToken: refreshToken,
    };
  }

  private async bumpLoginFailure(user: User) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    const update: Partial<User> = { failedLoginAttempts: attempts };
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      update.lockoutUntil = moment().add(LOCKOUT_MINUTES, 'minutes').toDate();
    }
    await this.userRepository.update(user.id, update);
  }

  async refreshTokens(refreshToken: string) {
    const payload = this.jwtHelper.verifyRefreshToken(refreshToken);
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      withDeleted: true,
    });

    // BE-19 — soft-deleted users must not be able to refresh tokens.
    if (!user || user.deletedAt) {
      await this.auditService.authFailure(
        AuditAction.REFRESH_FAILED,
        user?.email,
        { reason: !user ? 'unknown_user' : 'deleted', userId: user?.id },
      );
      throw new UnauthorizedException(UserMessages.INVALID_CREDENTIALS);
    }

    const stored = await this.refreshTokenRepositoryOperations.findRefreshToken(user, refreshToken);
    if (!stored) {
      await this.auditService.authFailure(AuditAction.REFRESH_FAILED, user.email, {
        reason: 'reused_or_unknown',
        userId: user.id,
      });
      throw new UnauthorizedException(UserMessages.INVALID_CREDENTIALS);
    }

    await this.refreshTokenRepositoryOperations.revokeRefreshToken(stored);

    const tokens = this.jwtHelper.generateTokens(user);
    await this.refreshTokenRepositoryOperations.saveRefreshToken(user, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async logout(refreshToken: string) {
    const payload = this.jwtHelper.verifyRefreshToken(refreshToken);
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
      withDeleted: true,
    });
    if (!user || user.deletedAt) {
      return { message: UserMessages.LOGOUT_SUCCESS };
    }
    const stored = await this.refreshTokenRepositoryOperations.findRefreshToken(
      user,
      refreshToken,
    );
    if (stored) {
      await this.refreshTokenRepositoryOperations.revokeRefreshToken(stored);
    }
    return { message: UserMessages.LOGOUT_SUCCESS };
  }

  async sendPasswordResetOtp(dto: SendPasswordResetOtpDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });

    // BE-19 — soft-deleted users must not be able to reset credentials.
    if (user && user.deletedAt) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_REQUESTED,
        dto.email,
        { reason: 'deleted', userId: user.id },
    const email = normalizeEmail(sendPasswordResetOtpDto.email);
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      // We deliberately throw NotFoundException with a generic message so
      // the response is identical to the "user exists" path: callers cannot
      // distinguish between an existing and a non-existing account.
      this.logger.warn(
        `Password-reset OTP requested for unknown email: ${email}`,
      );
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_REQUEST,
        email,
        { reason: 'unknown_email' },
      );
      throw new UnauthorizedException(UserMessages.INVALID_CREDENTIALS);
    }

    // Always respond with the same shape to avoid email enumeration.
    if (!user) {
      return { message: UserMessages.OTP_SENT };
    }

    const otp = this.userHelper.generateVerificationCode();
    user.passwordResetOtp = otp;
    user.passwordResetOtpExpiresAt = moment()
      .add(DEFAULT_PASSWORD_RESET_OT_MINUTES, 'minutes')
      .toDate();
    await this.userRepository.save(user);

    await this.emailService.sendPasswordResetEmail(
      user.email,
      otp,
      `${user.firstname} ${user.lastname}`,
    );

    return { message: UserMessages.OTP_SENT };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
  async resendResetPasswordVerificationOtp(resendOtpDto: ResendOtpDto) {
    try {
      if (!resendOtpDto.email) {
        throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
      }

      const email = normalizeEmail(resendOtpDto.email);
      const user = await this.userRepository.findOne({
        where: { email },
      });
      if (!user) {
        this.logger.warn(
          `Password-reset OTP resend requested for unknown email: ${email}`,
        );
        throw new NotFoundException(UserMessages.OTP_SENT);
      }

      const otpMinutes = parseInt(
        this.configService.get<string>('PASSWORD_RESET_OTP_MINUTES') ||
          String(DEFAULT_PASSWORD_RESET_OTP_MINUTES),
        10,
      );
      const otp = this.userHelper.generateVerificationCode();

      user.passwordResetCode = otp;
      user.passwordResetCodeExpiresAt = moment().add(otpMinutes, 'minutes').toDate();
      user.lastPasswordResetSentAt = new Date();
      await this.userRepository.save(user);

      // Best-effort delivery: failure here is logged but not surfaced, so
      // an attacker cannot probe for the existence of an account by
      // comparing success / failure responses.
      await this.emailService
        .sendPasswordResetEmail(
          user.email,
          otp,
          `${user.firstname} ${user.lastname}`,
        )
        .catch((err) => {
          this.logger.error(
            `Failed to deliver password-reset OTP to ${user.email}: ${err?.message ?? err}`,
          );
        });

      await this.auditService.authSuccess(
        AuditAction.PASSWORD_RESET_REQUEST,
        {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        // Note: action code is reused for the resend so dashboards can
        // group them; the metadata disambiguates which one fired.
      );

      return { message: UserMessages.OTP_SENT };
    } catch (error) {
      // #204 — Re-throw typed HTTP exceptions (e.g. BadRequestException,
      // NotFoundException) unchanged so clients see the real 4xx status;
      // only unexpected failures are normalised to 500.
      ErrorCatch(error, 'Error resending verification code');
    }
  }

  async verifyResetPasswordOtp(verifyOtpDto: VerifyOtpDto) {
    if (!verifyOtpDto.email) {
      throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
    }

    if (!verifyOtpDto.otp) {
      throw new BadRequestException(UserMessages.OTP_REQUIRED);
    }

    const email = normalizeEmail(verifyOtpDto.email);
    const user = await this.userRepository.findOne({
      where: { email },
    });

    // BE-19 — soft-deleted users must not be able to reset credentials.
    if (!user || user.deletedAt) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        dto.email,
        { reason: !user ? 'unknown_email' : 'deleted', userId: user?.id },
      );
      throw new UnauthorizedException(UserMessages.INVALID_OTP);
    }

    if (
      !user.passwordResetOtp ||
      user.passwordResetOtp !== dto.otp
    ) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        dto.email,
        { reason: 'invalid_otp', userId: user.id },
        email,
        { reason: 'invalid_code', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.INVALID_OTP);
    }

    if (
      !user.passwordResetOtpExpiresAt ||
      user.passwordResetOtpExpiresAt < new Date()
    ) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        dto.email,
        email,
        { reason: 'expired', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.OTP_EXPIRED);
    }

    if (!this.userHelper.isValidPassword(dto.password)) {
      throw new BadRequestException(UserMessages.IS_VALID_PASSWORD);
    }

    user.password = await this.userHelper.hashPassword(dto.password);
    user.passwordResetOtp = undefined;
    user.passwordResetOtpExpiresAt = undefined;
    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;
    await this.userRepository.save(user);

    await this.auditService.authSuccess(AuditAction.PASSWORD_RESET, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return { message: UserMessages.PASSWORD_RESET_SUCCESS };
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
      withDeleted: true,
    });

    // BE-19 — soft-deleted users must not be able to request new OTPs.
    if (!user || user.deletedAt) {
      throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    }

    return this.resendVerificationOtp(dto.email);
  }

  async setup2fa(userId: string, dto: Setup2faDto) {
    const user = await this.getActiveUserOrThrow(userId);
    return this.setupTotpProvider.setup(user, dto);
  }

  async verifyTotp(userId: string, dto: VerifyTotpDto) {
    const user = await this.getActiveUserOrThrow(userId);
    return this.verifyTotpProvider.verify(user, dto);
  }

  async useBackupCode(userId: string, dto: UseBackupCodeDto) {
    const user = await this.getActiveUserOrThrow(userId);
    return this.verifyTotpProvider.useBackupCode(user, dto);
  }

  async disable2fa(userId: string, dto: Disable2faDto) {
    const user = await this.getActiveUserOrThrow(userId);
    return this.manageTotpProvider.disable(user, dto);
  }

  private async getActiveUserOrThrow(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      withDeleted: true,
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException(UserMessages.USER_NOT_FOUND);
    }
    return user;
  }
}
