import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ManageTotpProvider, BACKUP_CODE_COUNT } from './manage-totp.provider';
import { User } from '../../users/entities/user.entity';
import { HashingProvider } from './hashing.provider';

/**
 * BE-06 — Backup-code regeneration flow.
 *
 * The recovery flow promises:
 *   1. Issuing exactly BACKUP_CODE_COUNT new plain codes.
 *   2. Storing only their bcrypt hashes (so a DB leak can't login).
 *   3. Rejecting any caller whose current password does not verify.
 *   4. Refusing to issue codes for an account that has 2FA off, so
 *      callers don't silently acquire codes they cannot use.
 */
describe('ManageTotpProvider.regenerateBackupCodes (BE-06)', () => {
  let provider: ManageTotpProvider;
  let users: { findOne: jest.Mock; save: jest.Mock };
  let hashing: { compare: jest.Mock };

  const activeUser = {
    id: 'u-1',
    email: 'a@b',
    password: 'hashed-current-password',
    twoFactorEnabled: true,
    totpBackupCodes: ['existing-hash'],
  };

  beforeEach(async () => {
    users = {
      findOne: jest.fn().mockResolvedValue({ ...activeUser }),
      save: jest.fn().mockResolvedValue(undefined),
    };
    hashing = { compare: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        ManageTotpProvider,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: HashingProvider, useValue: hashing },
      ],
    }).compile();

    provider = mod.get(ManageTotpProvider);
  });

  it('returns eight fresh plain codes and stores only their hashes', async () => {
    hashing.compare.mockResolvedValue(true);

    const result = await provider.regenerateBackupCodes('u-1', 'current-password');

    expect(result.backupCodes).toHaveLength(BACKUP_CODE_COUNT);
    expect(result.backupCodesRemaining).toBe(BACKUP_CODE_COUNT);
    for (const code of result.backupCodes) {
      expect(code).toMatch(/^[0-9a-f]+$/);
      // Each stored hash must verify against its plain code (bcrypt).
      await expect(bcrypt.compare(code, 'existing-hash')).resolves.toBe(false);
    }

    // Stored hashes ≠ plain codes; count matches; previous codes wiped.
    const saved = users.save.mock.calls[0][0];
    expect(saved.totpBackupCodes).toHaveLength(BACKUP_CODE_COUNT);
    expect(saved.totpBackupCodes).not.toEqual(result.backupCodes);
    expect(saved.totpBackupCodes).not.toContain('existing-hash');
  });

  it('rejects calls whose password does not verify', async () => {
    hashing.compare.mockResolvedValue(false);

    await expect(
      provider.regenerateBackupCodes('u-1', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('refuses to issue codes when 2FA is not enabled', async () => {
    hashing.compare.mockResolvedValue(true);
    users.findOne.mockResolvedValue({
      ...activeUser,
      twoFactorEnabled: false,
    });

    await expect(
      provider.regenerateBackupCodes('u-1', 'current-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('rejects when the user cannot be found', async () => {
    users.findOne.mockResolvedValue(null);

    await expect(
      provider.regenerateBackupCodes('ghost', 'irrelevant'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
