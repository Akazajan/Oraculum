import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ManageTotpProvider, BACKUP_CODE_COUNT } from './manage-totp.provider';
import { User } from '../../users/entities/user.entity';
import { HashingProvider } from './hashing.provider';
import { AuditAction, AuditService } from '../../audit/audit.service';

/**
 * BE-06 / BE-12 / BE-13 — Backup-code regeneration and one-time consumption.
 */
describe('ManageTotpProvider.regenerateBackupCodes (BE-06 / BE-13)', () => {
  let provider: ManageTotpProvider;
  let users: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let hashing: { compare: jest.Mock };
  let audit: { log: jest.Mock };

  const activeUser = {
    id: 'u-1',
    email: 'a@b',
    password: 'hashed-current-password',
    role: 'USER',
    twoFactorEnabled: true,
    totpBackupCodes: ['existing-hash'],
    backupCodeGeneration: 1,
  };

  beforeEach(async () => {
    users = {
      findOne: jest.fn().mockResolvedValue({ ...activeUser }),
      save: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };
    hashing = { compare: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(null) };

    const mod = await Test.createTestingModule({
      providers: [
        ManageTotpProvider,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: HashingProvider, useValue: hashing },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    provider = mod.get(ManageTotpProvider);
  });

  it('returns eight fresh plain codes and stores only their hashes', async () => {
    hashing.compare.mockResolvedValue(true);

    const result = await provider.regenerateBackupCodes(
      'u-1',
      'current-password',
    );

    expect(result.backupCodes).toHaveLength(BACKUP_CODE_COUNT);
    expect(result.backupCodesRemaining).toBe(BACKUP_CODE_COUNT);
    for (const code of result.backupCodes) {
      expect(code).toMatch(/^[0-9a-f]+$/);
      await expect(bcrypt.compare(code, 'existing-hash')).resolves.toBe(false);
    }

    const saved = users.save.mock.calls[0][0];
    expect(saved.totpBackupCodes).toHaveLength(BACKUP_CODE_COUNT);
    expect(saved.totpBackupCodes).not.toEqual(result.backupCodes);
    expect(saved.totpBackupCodes).not.toContain('existing-hash');
    // BE-13 — generation advances so previous codes are invalidated.
    expect(saved.backupCodeGeneration).toBe(2);
  });

  it('emits a regeneration audit event without code values (BE-13)', async () => {
    hashing.compare.mockResolvedValue(true);
    const result = await provider.regenerateBackupCodes('u-1', 'password');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.BACKUP_CODES_REGENERATED,
        outcome: 'SUCCESS',
        actor: expect.objectContaining({ id: 'u-1', email: 'a@b' }),
        metadata: expect.objectContaining({
          previousCount: 1,
          issuedCount: BACKUP_CODE_COUNT,
        }),
      }),
    );

    const meta = audit.log.mock.calls[0][0].metadata;
    const serialised = JSON.stringify(meta);
    for (const code of result.backupCodes) {
      expect(serialised).not.toContain(code);
    }
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

describe('ManageTotpProvider.consumeBackupCode (BE-12)', () => {
  let provider: ManageTotpProvider;
  let users: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    const hash = await bcrypt.hash('deadbeef01', 10);
    users = {
      findOne: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b',
        role: 'USER',
        totpBackupCodes: [hash],
        backupCodeGeneration: 1,
      }),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(null) };

    const execute = jest.fn().mockResolvedValue({ affected: 1 });
    const andWhere = jest.fn().mockReturnValue({ andWhere, execute });
    const where = jest.fn().mockReturnValue({ andWhere });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    users.createQueryBuilder.mockReturnValue({ update, set, where, andWhere, execute });

    const mod = await Test.createTestingModule({
      providers: [
        ManageTotpProvider,
        { provide: getRepositoryToken(User), useValue: users },
        { provide: HashingProvider, useValue: { compare: jest.fn() } },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    provider = mod.get(ManageTotpProvider);
  });

  it('atomically consumes a matching code and reports remaining', async () => {
    const result = await provider.consumeBackupCode('u-1', 'deadbeef01');
    expect(result.backupCodesRemaining).toBe(0);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.BACKUP_CODE_CONSUMED,
        outcome: 'SUCCESS',
      }),
    );
  });

  it('rejects unknown codes and audits the failure without the code value', async () => {
    await expect(
      provider.consumeBackupCode('u-1', 'ffffffff'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.BACKUP_CODE_FAILED,
        outcome: 'FAILURE',
        metadata: expect.objectContaining({ reason: 'unknown_or_replayed' }),
      }),
    );
    const meta = JSON.stringify(audit.log.mock.calls[0][0].metadata);
    expect(meta).not.toContain('ffffffff');
  });

  it('rejects when no codes remain (expired set)', async () => {
    users.findOne.mockResolvedValue({
      id: 'u-1',
      totpBackupCodes: [],
      backupCodeGeneration: 2,
    });
    await expect(
      provider.consumeBackupCode('u-1', 'deadbeef01'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
