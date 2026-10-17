import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { User } from '../users/entities/user.entity';
import { AuditAction, AuditService } from '../audit/audit.service';
import { JwtHelper } from './helper/jwt-helper';
import { RefreshTokenRepositoryOperations } from './providers/refreshToken.repository';
import { SetupTotpProvider } from './providers/setup-totp.provider';
import { VerifyTotpProvider } from './providers/verify-totp.provider';
import { ManageTotpProvider } from './providers/manage-totp.provider';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { UserHelper } from './helper/user-helper';
import { UserMessages } from './helper/user-messages';

// `otplib` is an external service irrelevant to these tests — mock it so the suite runs in isolation.
jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
  generateURI: jest.fn(() => 'otpauth://totp/example'),
  verifySync: jest.fn(),
}));

/**
 * #203 — resendVerificationOtp must surface typed HTTP exceptions
 * (400/404) instead of wrapping every error in a 500, while still
 * normalising unexpected failures to InternalServerErrorException.
 */
describe('AuthService email verification codes', () => {
  let service: AuthService;
  let users: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let userHelper: {
    generateVerificationCode: jest.Mock;
    isValidPassword: jest.Mock;
    hashPassword: jest.Mock;
    formatUserResponse: jest.Mock;
  };
  let email: { sendVerificationEmail: jest.Mock };
  let jwt: { generateAccessToken: jest.Mock; generateTokens: jest.Mock };
  let refreshTokens: { saveRefreshToken: jest.Mock };
  let audit: { authSuccess: jest.Mock; authFailure: jest.Mock };
  let user: Partial<User>;

  beforeEach(async () => {
    user = {
      id: 'user-1',
      email: 'jane.doe@example.com',
      firstname: 'Jane',
      lastname: 'Doe',
      role: 'USER' as any,
    };
    users = {
      findOne: jest.fn().mockResolvedValue(user),
      create: jest.fn((data) => data),
      save: jest.fn().mockResolvedValue(undefined),
    };
    userHelper = {
      generateVerificationCode: jest.fn().mockReturnValue('123456'),
      isValidPassword: jest.fn().mockReturnValue(true),
      hashPassword: jest.fn().mockResolvedValue('password-hash'),
      formatUserResponse: jest.fn((value) => value),
    };
    email = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    jwt = {
      generateAccessToken: jest.fn().mockReturnValue('access-token'),
      generateTokens: jest
        .fn()
        .mockReturnValue({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    };
    refreshTokens = { saveRefreshToken: jest.fn().mockResolvedValue(undefined) };
    audit = {
      authSuccess: jest.fn().mockResolvedValue(undefined),
      authFailure: jest.fn().mockResolvedValue(undefined),
    };

    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: UserHelper, useValue: userHelper },
        { provide: JwtHelper, useValue: jwt },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: RefreshTokenRepositoryOperations, useValue: refreshTokens },
        { provide: SetupTotpProvider, useValue: {} },
        { provide: VerifyTotpProvider, useValue: {} },
        { provide: ManageTotpProvider, useValue: {} },
        {
          provide: AuditService,
          useValue: audit,
        },
      ],
    }).compile();

    service = mod.get(AuthService);
  });

  it('sends a new verification code and returns the OTP_SENT message', async () => {
    const result = await service.resendVerificationOtp(user.email!);

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: user.email },
    });
    expect(userHelper.generateVerificationCode).toHaveBeenCalled();
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationCode: createHash('sha256').update('123456').digest('hex'),
      }),
    );
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(
      user.email,
      '123456',
      'Jane Doe',
    );
    expect(result).toEqual({ message: UserMessages.OTP_SENT });
  });

  it('persists a digest on registration while emailing the raw code', async () => {
    users.findOne.mockResolvedValue(null);

    await service.createUser({
      email: 'Jane.Doe@Example.com',
      firstname: 'Jane',
      lastname: 'Doe',
      password: 'StrongPass1!',
    });

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane.doe@example.com',
        verificationCode: createHash('sha256').update('123456').digest('hex'),
      }),
    );
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(
      user.email,
  it('normalizes the email before lookup and delivery', async () => {
    await service.resendVerificationOtp('  Jane.Doe@example.COM  ');

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: 'jane.doe@example.com' },
    });
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(
      'jane.doe@example.com',
      '123456',
      'Jane Doe',
    );
  });

  it('maps a concurrent duplicate-email insert to the existing conflict response', async () => {
    users.findOne.mockResolvedValue(null);
    users.save.mockRejectedValue({ code: '23505' });

    const error = await service
      .createUser({
        email: 'jane.doe@example.com',
        firstname: 'Jane',
        lastname: 'Doe',
        password: 'StrongPass1!',
      })
      .catch((err) => err);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(UserMessages.EMAIL_ALREADY_EXIST);
    expect(audit.authFailure).toHaveBeenCalledWith(
      AuditAction.REGISTER,
      'jane.doe@example.com',
      { reason: 'email_already_exists' },
    );
  });

  it('accepts a valid code stored as a digest', async () => {
    user.verificationCode = createHash('sha256').update('123456').digest('hex');
    user.verificationCodeExpiresAt = new Date(Date.now() + 60_000);

    await service.verifyOtp({ email: user.email!, otp: '123456' });

    expect(user.isVerified).toBe(true);
    expect(user.verificationCode).toBe('');
    expect(refreshTokens.saveRefreshToken).toHaveBeenCalledWith(
      user,
      'refresh-token',
    );
  });

  it('rejects an invalid code', async () => {
    user.verificationCode = createHash('sha256').update('123456').digest('hex');
    user.verificationCodeExpiresAt = new Date(Date.now() + 60_000);

    const error = await service
      .verifyOtp({ email: user.email!, otp: '654321' })
      .catch((err) => err);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe(UserMessages.INVALID_OTP);
    expect(user.isVerified).not.toBe(true);
  });

  it('rejects an expired code even when the submitted code matches', async () => {
    user.verificationCode = createHash('sha256').update('123456').digest('hex');
    user.verificationCodeExpiresAt = new Date(Date.now() - 60_000);

    const error = await service
      .verifyOtp({ email: user.email!, otp: '123456' })
      .catch((err) => err);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.message).toBe(UserMessages.OTP_EXPIRED);
    expect(user.isVerified).not.toBe(true);
  });

  it('returns 400 instead of 500 when the email is missing', async () => {
    const err = await service.resendVerificationOtp('').catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe(UserMessages.EMAIL_REQUIRED);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('returns 400 when the email is only whitespace', async () => {
    const err = await service.resendVerificationOtp('   ').resolve(() => undefined).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 instead of 500 when no user matches the email', async () => {
    users.findOne.mockResolvedValue(null);

    const err = await service
      .resendVerificationOtp('ghost@example.com')
      .catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
    expect(err.message).toBe(UserMessages.USER_NOT_FOUND);
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('still maps unexpected failures to 500', async () => {
    email.sendVerificationEmail.mockRejectedValue(new Error('SMTP down'));

    const err = await service
      .resendVerificationOtp(user.email!)
      .catch((e) => e);

    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(err.getStatus()).toBe(500);
  });
});

/**
 * #204 — resendResetPasswordVerificationOtp had the same blanket-catch
 * bug: typed HTTP exceptions (400/404) were swallowed and converted to
 * 500s. Same mock setup as the #203 block above.
 */
describe('AuthService.resendResetPasswordVerificationOtp (#204)', () => {
  let service: AuthService;
  let users: { findOne: jest.Mock; save: jest.Mock };
  let userHelper: { generateVerificationCode: jest.Mock };
  let email: { sendPasswordResetEmail: jest.Mock };
  let audit: { authSuccess: jest.Mock; authFailure: jest.Mock };
  let user: Partial<User>;

  beforeEach(async () => {
    user = {
      id: 'user-1',
      email: 'jane.doe@example.com',
      firstname: 'Jane',
      lastname: 'Doe',
      role: 'USER' as any,
    };
    users = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockResolvedValue(undefined),
    };
    userHelper = {
      generateVerificationCode: jest.fn().mockReturnValue('654321'),
    };
    email = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    audit = {
      authSuccess: jest.fn().mockResolvedValue(undefined),
      authFailure: jest.fn().mockResolvedValue(undefined),
    };

    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: UserHelper, useValue: userHelper },
        { provide: JwtHelper, useValue: {} },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: RefreshTokenRepositoryOperations, useValue: {} },
        { provide: SetupTotpProvider, useValue: {} },
        { provide: VerifyTotpProvider, useValue: {} },
        { provide: ManageTotpProvider, useValue: {} },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = mod.get(AuthService);
  });

  it('persists a new reset OTP, delivers it and returns OTP_SENT', async () => {
    const result = await service.resendResetPasswordVerificationOtp({
      email: user.email!,
    });

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: user.email },
    });
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordResetCode: '654321' }),
    );
    expect(email.sendPasswordResetEmail).toHaveBeenCalledWith(
      user.email,
      '654321',
      'Jane Doe',
    );
    expect(audit.authSuccess).toHaveBeenCalledWith(
      AuditAction.PASSWORD_RESET_REQUEST,
      expect.objectContaining({ email: user.email }),
    );
    expect(result).toEqual({ message: UserMessages.OTP_SENT });
  });

  it('normalizes the email for reset lookup and delivery', async () => {
    await service.resendResetPasswordVerificationOtp({
      email: '  JANE.DOE@EXAMPLE.COM ',
    });

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: 'jane.doe@example.com' },
    });
    expect(email.sendPasswordResetEmail).toHaveBeenCalledWith(
      'jane.doe@example.com',
      '654321',
      'Jane Doe',
    );
  });

  it('returns 400 instead of 500 when the email is missing', async () => {
    const err = await service
      .resendResetPasswordVerificationOtp({ email: '' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe(UserMessages.EMAIL_REQUIRED);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('returns 400 when the email is only whitespace', async () => {
    const err = await service
      .resendResetPasswordVerificationOtp({ email: '   ' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('returns 404 instead of 500 when no user matches the email', async () => {
    users.findOne.mockResolvedValue(null);

    const err = await service
      .resendResetPasswordVerificationOtp({ email: 'ghost@example.com' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(audit.authSuccess).not.toHaveBeenCalled();
  });

  it('still maps unexpected failures to 500', async () => {
    users.save.mockRejectedValue(new Error('db down'));

    const err = await service
      .resendResetPasswordVerificationOtp({ email: user.email! })
      .catch((e) => e);

    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(err.getStatus()).toBe(500);
  });
});

/**
 * BE-17 — email normalization must be consistent across registration,
 * login, reset and uniqueness checks. Case/whitespace variants of the
 * same address must resolve to one account.
 */
describe('AuthService email normalization (BE-17)', () => {
  let service: AuthService;
  let users: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let userHelper: { generateVerificationCode: jest.Mock };
  let email: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  let user: Partial<User>;

  beforeEach(async () => {
    user = {
      id: 'user-1',
      email: 'jane.doe@example.com',
      firstname: 'Jane',
      lastname: 'Doe',
      role: 'USER' as any,
    };
    users = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
    };
    userHelper = {
      generateVerificationCode: jest.fn().mockReturnValue('123456'),
    };
    email = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: UserHelper, useValue: userHelper },
        { provide: JwtHelper, useValue: {} },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: RefreshTokenRepositoryOperations, useValue: {} },
        { provide: SetupTotpProvider, useValue: {} },
        { provide: VerifyTotpProvider, useValue: {} },
        { provide: ManageTotpProvider, useValue: {} },
        {
          provide: AuditService,
          useValue: { authSuccess: jest.fn(), authFailure: jest.fn() },
        },
      ],
    }).compile();

    service = mod.get(AuthService);
  });

  it('resolves case variants to the same account on resend verification', async () => {
    await service.resendVerificationOtp('Jane.Doe@example.COM');

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: 'jane.doe@example.com' },
    });
  });

  it('resolves whitespace variants to the same account on reset', async () => {
    await service.resendResetPasswordVerificationOtp({
      email: '  jane.doe@example.com  ',
    });

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: 'jane.doe@example.com' },
    });
  });

  it('treats case/variants as the same account for uniqueness checks', async () => {
    await service.resendVerificationOtp(' Jane.Doe@example.COM ');

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: 'jane.doe@example.com' },
    });
    expect(users.create).not.toHaveBeenCalled();
  });
});
