import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ResetPasswordProvider } from './resetPassword.provider';
import { User } from '../entities/user.entity';
import { HashingProvider } from 'src/auth/providers/hashing.provider';
import { RefreshTokenRepositoryOperations } from 'src/auth/providers/refreshToken.repository';
import { EmailService } from '../../email/email.service';

type MockRepo<T extends Record<string, any>> = {
  [K in keyof T]: jest.Mock;
} & {
  update: jest.Mock;
  findOne: jest.Mock;
};

function buildRepoStub() {
  const stub: Partial<MockRepo<Repository<User>>> = {
    update: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
  return stub as MockRepo<Repository<User>>;
}

describe('ResetPasswordProvider (single-use token)', () => {
  let provider: ResetPasswordProvider;
  let usersRepo: MockRepo<Repository<User>>;
  let hashing: { hash: jest.Mock };
  let refreshTokens: { revokeAllRefreshTokens: jest.Mock };
  let emails: { sendPasswordResetSuccessEmail: jest.Mock };

  const RAW_TOKEN = 'a'.repeat(64);
  const HASHED = createHash('sha256').update(RAW_TOKEN).digest('hex');

  beforeEach(async () => {
    usersRepo = buildRepoStub();
    hashing = { hash: jest.fn().mockResolvedValue('hashed-pw') };
    refreshTokens = {
      revokeAllRefreshTokens: jest.fn().mockResolvedValue(undefined),
    };
    emails = {
      sendPasswordResetSuccessEmail: jest.fn().mockResolvedValue(true),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ResetPasswordProvider,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: HashingProvider, useValue: hashing },
        {
          provide: RefreshTokenRepositoryOperations,
          useValue: refreshTokens,
        },
        { provide: EmailService, useValue: emails },
      ],
    }).compile();

    provider = mod.get(ResetPasswordProvider);
  });

  it('rejects obviously-bogus tokens without a DB call', async () => {
    await expect(provider.execute('short', 'newPw1234')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersRepo.update).not.toHaveBeenCalled();
    expect(usersRepo.findOne).not.toHaveBeenCalled();
  });

  it('rejects when no user owns the token with a non-leaking message', async () => {
    usersRepo.findOne.mockResolvedValue(null);
    let caught: any;
    try {
      await provider.execute(RAW_TOKEN, 'newPw1234');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    // Identical wording to the zero-affected (lost race) branch so callers
    // cannot distinguish between missing and already-consumed tokens.
    expect(caught.response.message).toBe('Invalid or expired reset token');
  });

  it('rejects an expired token with an actionable error and does not update', async () => {
    usersRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b',
      firstname: 'A',
      lastname: 'B',
      passwordResetToken: HASHED,
      passwordResetExpiresIn: new Date(Date.now() - 1000),
    } as any);
    await expect(
      provider.execute(RAW_TOKEN, 'newPw1234'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersRepo.update).not.toHaveBeenCalled();
  });

  it('consumes the token atomically and triggers post-reset cleanup', async () => {
    usersRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b',
      firstname: 'A',
      lastname: 'B',
      passwordResetToken: HASHED,
      passwordResetExpiresIn: new Date(Date.now() + 60_000),
    } as any);
    usersRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    const result = await provider.execute(RAW_TOKEN, 'newPw1234');
    expect(result).toEqual({ message: 'Password reset successful' });
    expect(usersRepo.update).toHaveBeenCalledTimes(1);
    expect(refreshTokens.revokeAllRefreshTokens).toHaveBeenCalledWith('u1');
    expect(emails.sendPasswordResetSuccessEmail).toHaveBeenCalled();
  });

  it('treats a zero-affected update as already-used (race-safe)', async () => {
    usersRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b',
      firstname: 'A',
      lastname: 'B',
      passwordResetToken: HASHED,
      passwordResetExpiresIn: new Date(Date.now() + 60_000),
    } as any);
    // Simulate losing the race against a concurrent reset.
    usersRepo.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

    await expect(
      provider.execute(RAW_TOKEN, 'newPw1234'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(refreshTokens.revokeAllRefreshTokens).not.toHaveBeenCalled();
    expect(emails.sendPasswordResetSuccessEmail).not.toHaveBeenCalled();
  });

  it('succeeds even if the post-reset email fails', async () => {
    usersRepo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b',
      firstname: 'A',
      lastname: 'B',
      passwordResetToken: HASHED,
      passwordResetExpiresIn: new Date(Date.now() + 60_000),
    } as any);
    usersRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    emails.sendPasswordResetSuccessEmail.mockRejectedValueOnce(
      new Error('smtp down'),
    );

    const result = await provider.execute(RAW_TOKEN, 'newPw1234');
    expect(result).toEqual({ message: 'Password reset successful' });
  });
});
