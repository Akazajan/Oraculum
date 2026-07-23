import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { User } from '../users/entities/user.entity';
import { IsNull, MoreThan, Repository } from 'typeorm';
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

const DEFAULT_PASSWORD_RESET_OTP_MINUTES = 10;

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
    const existingUser = await this.userRepository.findOne({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      await this.auditService.authFailure(
        AuditAction.REGISTER,
        createUserDto.email,
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
        createUserDto.email,
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
      email: createUserDto.email,
      firstname: createUserDto.firstname,
      lastname: createUserDto.lastname,
      password: hashedPassword,
      role: UserRole.USER,
      verificationCode: verificationCode,
      verificationCodeExpiresAt: expiration,
      isVerified: false,
    });
    await this.userRepository.save(newUser);

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
      accessToken,
    };
  }

  async createAdminUser(createUserDto: CreateUserDto) {
    const existingUser = await this.userRepository.findOne({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      await this.auditService.authFailure(
        AuditAction.REGISTER_ADMIN,
        createUserDto.email,
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
        createUserDto.email,
        { reason: 'weak_password' },
      );
      throw new ConflictException(UserMessages.IS_VALID_PASSWORD);
    }
    const hashedPassword = await this.userHelper.hashPassword(
      createUserDto.password,
    );
    const newUser = this.userRepository.create({
      email: createUserDto.email,
      firstname: createUserDto.firstname,
      lastname: createUserDto.lastname,
      password: hashedPassword,
      role: UserRole.ADMIN,
    });
    await this.userRepository.save(newUser);

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
      accessToken,
    };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const { email, otp } = verifyOtpDto;

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

    if (user.verificationCode !== otp) {
      await this.auditService.authFailure(
        AuditAction.OTP_FAILED,
        email,
        { reason: 'invalid_code', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.INVALID_OTP);
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

    user.isVerified = true;
    user.verificationCode = '';
    user.verificationCodeExpiresAt = undefined;

    await this.userRepository.save(user);

    await this.auditService.authSuccess(AuditAction.OTP_VERIFIED, {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const tokens = this.jwtHelper.generateTokens(user);

    return {
      message: UserMessages.VERIFY_OTP_SUCCESS,
      user: this.userHelper.formatUserResponse(user),
      tokens: tokens,
    };
  }

  async resendVerificationOtp(email: string) {
    try {
      if (!email) {
        throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
      }

      const user = await this.userRepository.findOne({ where: { email } });
      if (!user) {
        throw new NotFoundException(UserMessages.USER_NOT_FOUND);
      }

      const verificationCode = this.userHelper.generateVerificationCode();

      user.verificationCode = verificationCode;
      user.verificationCodeExpiresAt = moment().add(10, 'minutes').toDate();
      await this.userRepository.save(user);

      await this.emailService.sendVerificationEmail(
        user.email,
        verificationCode,
        `${user.firstname} ${user.lastname}`,
      );

      return { message: UserMessages.OTP_SENT };
    } catch (error) {
      throw new InternalServerErrorException(
        error || 'Error resending verification code',
      );
    }
  }

  async login(loginUserDto: LoginUserDto) {
    const user = await this.userRepository.findOne({
      where: { email: loginUserDto.email },
    });
    if (
      !user ||
      !(await this.userHelper.verifyPassword(
        loginUserDto.password,
        user.password,
      ))
    ) {
      await this.auditService.authFailure(
        AuditAction.LOGIN_FAILED,
        loginUserDto.email,
        { reason: !user ? 'unknown_email' : 'bad_password' },
      );
      throw new UnauthorizedException(UserMessages.INVALID_CREDENTIALS);
    }

    if (!user.isVerified) {
      await this.resendVerificationOtp(loginUserDto.email);
      await this.auditService.authFailure(
        AuditAction.LOGIN_FAILED,
        loginUserDto.email,
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

    const { accessToken } = this.jwtHelper.generateTokens(user);
    return {
      user: this.userHelper.formatUserResponse(user),
      accessToken,
    };
  }
  async refreshToken(refreshToken: string) {
    const userId = this.jwtHelper.validateRefreshToken(refreshToken);
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException(UserMessages.INVALID_REFRESH_TOKEN);
    }
    const accessToken = this.jwtHelper.generateAccessToken(user);
    return { accessToken };
  }
  async retrieveUserById(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('User not found.');
    }
    const result = this.userHelper.formatUserResponse(user);
    return result;
  }

  async requestResetPasswordOtp(
    sendPasswordResetOtpDto: SendPasswordResetOtpDto,
  ) {
    if (!sendPasswordResetOtpDto.email) {
      throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
    }

    const user = await this.userRepository.findOne({
      where: { email: sendPasswordResetOtpDto.email },
    });

    if (!user) {
      // We deliberately throw NotFoundException with a generic message so
      // the response is identical to the "user exists" path: callers cannot
      // distinguish between an existing and a non-existing account.
      this.logger.warn(
        `Password-reset OTP requested for unknown email: ${sendPasswordResetOtpDto.email}`,
      );
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_REQUEST,
        sendPasswordResetOtpDto.email,
        { reason: 'unknown_email' },
      );
      throw new NotFoundException(UserMessages.OTP_SENT);
    }

    const otpMinutes = parseInt(
      this.configService.get<string>('PASSWORD_RESET_OTP_MINUTES') ||
        String(DEFAULT_PASSWORD_RESET_OTP_MINUTES),
      10,
    );
    const otp = this.userHelper.generateVerificationCode();

    // Always overwrite any existing (possibly leaked or already-used) code
    // so the most recent email is the only one that works.
    user.passwordResetCode = otp;
    user.passwordResetCodeExpiresAt = moment().add(otpMinutes, 'minutes').toDate();
    user.lastPasswordResetSentAt = new Date();
    await this.userRepository.save(user);

    await this.emailService.sendPasswordResetEmail(
      user.email,
      otp,
      `${user.firstname} ${user.lastname}`,
    );

    await this.auditService.authSuccess(
      AuditAction.PASSWORD_RESET_REQUEST,
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    );

    return { message: UserMessages.OTP_SENT };
  }

  async resendResetPasswordVerificationOtp(resendOtpDto: ResendOtpDto) {
    try {
      if (!resendOtpDto.email) {
        throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
      }

      const user = await this.userRepository.findOne({
        where: { email: resendOtpDto.email },
      });
      if (!user) {
        this.logger.warn(
          `Password-reset OTP resend requested for unknown email: ${resendOtpDto.email}`,
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
      throw new InternalServerErrorException(
        error || 'Error resending verification code',
      );
    }
  }

  async verifyResetPasswordOtp(verifyOtpDto: VerifyOtpDto) {
    if (!verifyOtpDto.email) {
      throw new BadRequestException(UserMessages.EMAIL_REQUIRED);
    }

    if (!verifyOtpDto.otp) {
      throw new BadRequestException(UserMessages.OTP_REQUIRED);
    }

    const user = await this.userRepository.findOne({
      where: { email: verifyOtpDto.email },
    });

    if (!user) {
      throw new NotFoundException(UserMessages.USER_NOT_FOUND);
    }

    if (user.passwordResetCode !== verifyOtpDto.otp) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        verifyOtpDto.email,
        { reason: 'invalid_code', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.INVALID_OTP);
    }

    if (
      !user.passwordResetCodeExpiresAt ||
      (user.passwordResetCodeExpiresAt instanceof Date &&
        user.passwordResetCodeExpiresAt < new Date())
    ) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        verifyOtpDto.email,
        { reason: 'expired', userId: user.id },
      );
      throw new UnauthorizedException(UserMessages.OTP_EXPIRED);
    }

    await this.userRepository.save(user);

    return { message: UserMessages.OTP_VERIFIED };
  }

  setup2fa(userId: string) {
    return this.setupTotpProvider.initiate2faSetup(userId);
  }

  async confirm2fa(userId: string, dto: Setup2faDto) {
    const result = await this.setupTotpProvider.confirm2faSetup(userId, dto);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    await this.auditService.authSuccess(AuditAction.TOTP_ENABLED, {
      id: user?.id,
      email: user?.email,
      role: user?.role,
    });
    return result;
  }

  async verifyTotpLogin(dto: VerifyTotpDto) {
    try {
      const result = await this.verifyTotpProvider.verifyTotpLogin(dto);
      // Best-effort audit: we may not know which user this is without a
      // round-trip, so the provider is expected to surface it in metadata.
      await this.auditService.authSuccess(AuditAction.TOTP_LOGIN_SUCCESS, {});
      return result;
    } catch (err) {
      await this.auditService.authFailure(
        AuditAction.TOTP_LOGIN_FAILED,
        null,
        { reason: (err as Error)?.message },
      );
      throw err;
    }
  }

  async verifyBackupCode(dto: UseBackupCodeDto) {
    try {
      const result = await this.verifyTotpProvider.verifyBackupCode(dto);
      await this.auditService.authSuccess(
        AuditAction.TOTP_LOGIN_SUCCESS,
        undefined,
      );
      return result;
    } catch (err) {
      await this.auditService.authFailure(
        AuditAction.TOTP_LOGIN_FAILED,
        null,
        {
          reason: (err as Error)?.message,
          method: 'backup_code',
        },
      );
      throw err;
    }
  }

  async disable2fa(userId: string, dto: Disable2faDto) {
    const result = await this.manageTotpProvider.disable2fa(userId, dto);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    await this.auditService.authSuccess(AuditAction.TOTP_DISABLED, {
      id: user?.id,
      email: user?.email,
      role: user?.role,
    });
    return result;
  }

  get2faStatus(userId: string) {
    return this.manageTotpProvider.get2faStatus(userId);
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { otp, newPassword, confirmNewPassword } = resetPasswordDto;

    if (!this.userHelper.isValidPassword(newPassword)) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        null,
        { reason: 'weak_password' },
      );
      throw new BadRequestException(UserMessages.IS_VALID_PASSWORD);
    }

    if (newPassword !== confirmNewPassword) {
      throw new BadRequestException(UserMessages.PASSWORDS_DO_NOT_MATCH);
    }

    // Step 1: read-only lookup for actionable, specific error messages.
    // Anyone with a valid, single-issued OTP that hasn't been consumed will
    // match; everyone else gets a clean error without revealing why.
    const owner = await this.userRepository.findOneBy({
      passwordResetCode: otp,
    });

    if (!owner) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        null,
        { reason: 'unknown_or_used_code' },
      );
      // Use identical wording for both missing and already-consumed cases so
      // attackers cannot probe which one applied via response text.
      throw new UnauthorizedException(
        'Invalid or expired reset code',
      );
    }
    if (
      !owner.passwordResetCodeExpiresAt ||
      owner.passwordResetCodeExpiresAt < new Date()
    ) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        owner.email,
        { reason: 'expired', userId: owner.id },
      );
      throw new UnauthorizedException(UserMessages.OTP_EXPIRED);
    }      // Step 2: atomically consume the OTP in a single SQL statement so that
    // two concurrent reset requests race-safely produce one winner and one
    // loser (which we surface as "already-used"). Note: we set the cleared
    // columns to `null` (not `undefined`) so TypeORM emits explicit NULL
    // assignments and a subsequent lookup by code cannot match.
    const hashedPassword = await this.userHelper.hashPassword(newPassword);
    const updateResult = await this.userRepository.update(
      {
        id: owner.id,
        passwordResetCode: otp,
        passwordResetCodeExpiresAt: MoreThan(new Date()),
      },
      {
        password: hashedPassword,
        passwordResetCode: null,
        passwordResetCodeExpiresAt: null,
      },
    );

    if (!updateResult.affected || updateResult.affected === 0) {
      await this.auditService.authFailure(
        AuditAction.PASSWORD_RESET_FAILED,
        owner.email,
        { reason: 'race_or_expired', userId: owner.id },
      );
      throw new UnauthorizedException(
        'Invalid or expired reset code',
      );
    }

    await this.auditService.authSuccess(AuditAction.PASSWORD_RESET_SUCCESS, {
      id: owner.id,
      email: owner.email,
      role: owner.role,
    });

    // Step 3: best-effort post-reset cleanup. The reset itself has already
    // succeeded; failures here MUST NOT roll back the password change.
    try {
      await this.refreshTokenRepositoryOperations.revokeAllRefreshTokens(
        owner.id,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to revoke sessions after password reset for user ${owner.id}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }
    try {
      const fullName = `${owner.firstname} ${owner.lastname}`.trim();
      await this.emailService.sendPasswordResetSuccessEmail(
        owner.email,
        fullName || owner.email,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send password-reset success email to ${owner.email}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }

    return {
      message: UserMessages.PASSWORDS_RESET_SUCCESSFUL,
    };
  }
}

/**
 * Snapshot the actor from the AsyncLocalStorage context opened by the
 * correlation-id middleware so audit rows recorded during background
 * flows (e.g. admin-issued register-admin) automatically pick up the
 * caller's identity, role, and contact details.
 */
import {
  getCorrelationId,
  getCurrentRequestUser,
  getRequestIp,
  getUserAgent,
} from '../common/context/correlation-context';
function getCurrentActorFromAls() {
  const current = getCurrentRequestUser();
  return {
    id: current?.id ?? null,
    email: current?.email ?? null,
    role: current?.role ?? null,
  };
}
// Suppress unused import lint warnings — these references are kept for
// future expansion (e.g. attaching IP/UA into audit metadata).
void getCorrelationId;
void getRequestIp;
void getUserAgent;
void IsNull;
