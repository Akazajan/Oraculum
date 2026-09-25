import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
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

// `otplib` pulls in ESM-only deps (@scure/base) that Jest cannot parse
// outside of transformIgnorePatterns, and it is an external service
// irrelevant to these tests — mock it so the suite runs in isolation.
jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
  generateURI: jest.fn(() => 'otpauth://totp/example'),
  verifySync: jest.fn(),
}));

/**
 * #203 — resendVerificationOtp must surface typed HTTP exceptions
 * (400/404) instead of wrapping every error in a 500, while still
 * normalising unexpected failures to InternalServerErrorException.
 *
 * Follows the project's standard pattern from
 * `auth/providers/refresh-token-rotation.spec.ts` — register the
 * collaborators as plain inline mocks rather than the full DI graph.
 */
describe('AuthService.resendVerificationOtp (#203)', () => {
  let service: AuthService;
  let users: { findOne: jest.Mock; save: jest.Mock };
  let userHelper: { generateVerificationCode: jest.Mock };
  let email: { sendVerificationEmail: jest.Mock };
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
      generateVerificationCode: jest.fn().mockReturnValue('123456'),
    };
    email = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
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

  it('sends a new verification code and returns the OTP_SENT message', async () => {
    const result = await service.resendVerificationOtp(user.email!);

    expect(users.findOne).toHaveBeenCalledWith({
      where: { email: user.email },
    });
    expect(userHelper.generateVerificationCode).toHaveBeenCalled();
    expect(users.save).toHaveBeenCalledWith(
      expect.objectContaining({ verificationCode: '123456' }),
    );
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(
      user.email,
      '123456',
      'Jane Doe',
    );
    expect(result).toEqual({ message: UserMessages.OTP_SENT });
  });

  it('returns 400 instead of 500 when the email is missing', async () => {
    const err = await service.resendVerificationOtp('').catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe(UserMessages.EMAIL_REQUIRED);
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

  it('returns 400 instead of 500 when the email is missing', async () => {
    const err = await service
      .resendResetPasswordVerificationOtp({ email: '' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe(UserMessages.EMAIL_REQUIRED);
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
