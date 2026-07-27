import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from '../auth.service';
import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { JwtHelper } from '../helper/jwt-helper';
import { RefreshTokenRepositoryOperations } from './refreshToken.repository';
import { HashingProvider } from './hashing.provider';
import { SetupTotpProvider } from './setup-totp.provider';
import { VerifyTotpProvider } from './verify-totp.provider';
import { ManageTotpProvider } from './manage-totp.provider';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';
import { UserHelper } from '../helper/user-helper';

/**
 * BE-04 — Refresh-token rotation & replay detection tests.
 *
 * Mirrors the project's standard pattern in
 * `users/providers/resetPassword.provider.spec.ts` — register the
 * collaborator providers as plain inline objects rather than relying
 * on the NestJS DI graph.
 */
describe('AuthService.refreshToken (BE-04)', () => {
  let service: AuthService;
  let users: { findOne: jest.Mock };
  let refreshRepo: {
    findToken: jest.Mock;
    revokeToken: jest.Mock;
    revokeFamily: jest.Mock;
    saveRefreshToken: jest.Mock;
  };
  let jwtHelper: {
    validateRefreshToken: jest.Mock;
    generateAccessToken: jest.Mock;
    generateRefreshToken: jest.Mock;
  };
  let audit: { authFailure: jest.Mock; authSuccess: jest.Mock };

  const user: Partial<User> = {
    id: 'user-1',
    email: 'a@b',
    role: 'USER' as any,
  };

  beforeEach(async () => {
    users = { findOne: jest.fn() };
    refreshRepo = {
      findToken: jest.fn(),
      revokeToken: jest.fn().mockResolvedValue(undefined),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      saveRefreshToken: jest.fn().mockResolvedValue(undefined),
    };
    jwtHelper = {
      validateRefreshToken: jest
        .fn()
        .mockReturnValue({ userId: 'user-1', family: 'fam-A' }),
      generateAccessToken: jest.fn().mockReturnValue('new-access'),
      generateRefreshToken: jest.fn().mockReturnValue('new-refresh'),
    };
    audit = {
      authFailure: jest.fn().mockResolvedValue(undefined),
      authSuccess: jest.fn().mockResolvedValue(undefined),
    };

    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: JwtHelper, useValue: jwtHelper },
        { provide: RefreshTokenRepositoryOperations, useValue: refreshRepo },
        { provide: AuditService, useValue: audit },
        { provide: HashingProvider, useValue: {} },
        { provide: SetupTotpProvider, useValue: {} },
        { provide: VerifyTotpProvider, useValue: {} },
        { provide: ManageTotpProvider, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: UserHelper, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: () => undefined },
        },
      ],
    }).compile();

    service = mod.get(AuthService);
  });

  it('rejects when no refresh token is supplied', async () => {
    await expect(service.refreshToken('')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotates a fresh refresh token into a new pair in the same family', async () => {
    refreshRepo.findToken.mockResolvedValue({
      revoked: false,
      family: 'fam-A',
      userId: 'user-1',
      expiresAt: undefined,
    });
    users.findOne.mockResolvedValue(user);

    const result = await service.refreshToken('rt-original');

    expect(jwtHelper.generateAccessToken).toHaveBeenCalledWith(user);
    expect(jwtHelper.generateRefreshToken).toHaveBeenCalledWith(user, 'fam-A');
    expect(refreshRepo.revokeToken).toHaveBeenCalledWith(
      'rt-original',
      'rotation',
    );
    expect(refreshRepo.saveRefreshToken).toHaveBeenCalledWith(
      user,
      'new-refresh',
      'fam-A',
    );
    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(audit.authFailure).not.toHaveBeenCalled();
  });

  it('rejects when the token does not exist in the DB', async () => {
    refreshRepo.findToken.mockResolvedValue(null);

    await expect(service.refreshToken('rt-ghost')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refreshRepo.revokeFamily).not.toHaveBeenCalled();
    expect(refreshRepo.revokeToken).not.toHaveBeenCalled();
  });

  it('treats a replayed (already-revoked) token as theft and kills the family', async () => {
    refreshRepo.findToken.mockResolvedValue({
      revoked: true,
      family: 'fam-A',
      userId: 'user-1',
      expiresAt: undefined,
    });

    await expect(service.refreshToken('rt-stolen')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refreshRepo.revokeFamily).toHaveBeenCalledWith('fam-A', 'replay');
    expect(audit.authFailure).toHaveBeenCalledWith(
      'LOGIN_FAILED',
      null,
      expect.objectContaining({ reason: 'refresh_token_replay' }),
    );
    expect(refreshRepo.revokeToken).not.toHaveBeenCalled();
  });

  it('rejects an expired token without rotating', async () => {
    refreshRepo.findToken.mockResolvedValue({
      revoked: false,
      family: 'fam-A',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.refreshToken('rt-expired')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refreshRepo.revokeToken).not.toHaveBeenCalled();
    expect(refreshRepo.saveRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects when the JWT signature is valid but the DB claim is null', async () => {
    //jwtHelper.validateRefreshToken returns null → service must throw.
    jwtHelper.validateRefreshToken.mockReturnValue(null);

    await expect(service.refreshToken('rt-anything')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Fail-fast: neither DB lookup nor audit must run if the claim is null,
    // otherwise a future regression that adds an audit between the two
    // would silently surface a log entry for an unauthenticated request.
    expect(refreshRepo.findToken).not.toHaveBeenCalled();
    expect(audit.authFailure).not.toHaveBeenCalled();
    expect(refreshRepo.revokeToken).not.toHaveBeenCalled();
    expect(refreshRepo.saveRefreshToken).not.toHaveBeenCalled();
  });
});
