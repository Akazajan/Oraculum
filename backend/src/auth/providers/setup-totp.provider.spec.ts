import { UnauthorizedException } from '@nestjs/common';
import { SetupTotpProvider } from './setup-totp.provider';

jest.mock('otplib', () => ({
  generateSecret: () => 'SECRET',
  generateURI: () => 'otpauth://test',
  verifySync: jest.fn(),
}));
jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async () => 'data:image/png;base64,xx'),
}));
jest.mock('./manage-totp.provider', () => ({
  generateAndHashBackupCodes: jest.fn(async () => ({
    plain: ['a', 'b'],
    hashed: ['h1', 'h2'],
  })),
}));

import { verifySync } from 'otplib';

describe('SetupTotpProvider (BE-11)', () => {
  const repo = {
    findOne: jest.fn(),
    save: jest.fn(async (u) => u),
  };
  const provider = new SetupTotpProvider(repo as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('setup alone does not enable 2FA', async () => {
    repo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      twoFactorEnabled: false,
      totpSecret: undefined,
    });
    const result = await provider.initiate2faSetup('u1');
    expect(result.twoFactorEnabled).toBe(false);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        totpPendingSecret: 'SECRET',
        twoFactorEnabled: false,
      }),
    );
  });

  it('valid confirmation enables 2FA', async () => {
    (verifySync as jest.Mock).mockReturnValue({ valid: true });
    repo.findOne.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      twoFactorEnabled: false,
      totpPendingSecret: 'SECRET',
    });
    const result = await provider.confirm2faSetup('u1', { token: '123456' } as any);
    expect(result.twoFactorEnabled).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        twoFactorEnabled: true,
        totpSecret: 'SECRET',
      }),
    );
  });

  it('invalid confirmation leaves 2FA disabled', async () => {
    (verifySync as jest.Mock).mockReturnValue({ valid: false });
    repo.findOne.mockResolvedValue({
      id: 'u1',
      twoFactorEnabled: false,
      totpPendingSecret: 'SECRET',
    });
    await expect(
      provider.confirm2faSetup('u1', { token: '000000' } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
