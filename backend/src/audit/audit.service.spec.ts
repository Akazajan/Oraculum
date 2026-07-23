import { AuditService, AuditAction } from './audit.service';
import { runWithRequestContext } from '../common/context/correlation-context';
import { AuditLog } from './entities/audit-log.entity';
import { Repository } from 'typeorm';

describe('AuditService', () => {
  let repoCreate: jest.Mock;
  let repoSave: jest.Mock;
  let service: AuditService;

  beforeEach(() => {
    repoCreate = jest.fn((row: Partial<AuditLog>) => ({
      id: 'audit-row-id',
      createdAt: new Date(),
      ...row,
    } as AuditLog));
    repoSave = jest.fn(async (row: AuditLog) => row);
    const repo = {
      create: repoCreate,
      save: repoSave,
    } as unknown as Repository<AuditLog>;
    service = new AuditService(repo);
  });

  it('records successful auth events with actor + cid', async () => {
    await runWithRequestContext(
      {
        correlationId: 'cid-abc',
        request: { ip: '203.0.113.1', userAgent: 'jest' },
      },
      async () => {
        await service.authSuccess(AuditAction.LOGIN_SUCCESS, {
          id: 'user-1',
          email: 'user@example.com',
          role: 'USER',
        });
      },
    );

    expect(repoCreate).toHaveBeenCalledTimes(1);
    const row = repoCreate.mock.calls[0][0] as Partial<AuditLog>;
    expect(row).toMatchObject({
      action: 'LOGIN_SUCCESS',
      outcome: 'SUCCESS',
      actorId: 'user-1',
      actorEmail: 'user@example.com',
      actorRole: 'USER',
      correlationId: 'cid-abc',
      ip: '203.0.113.1',
      userAgent: 'jest',
    });
  });

  it('records failed auth events with attempted email only', async () => {
    await runWithRequestContext(
      {
        correlationId: undefined as never,
        request: { ip: '', userAgent: '' },
        // Force the ALS fallback to assert default behaviour.
      } as never,
      async () => {
        await service.authFailure(
          AuditAction.LOGIN_FAILED,
          'attempted@example.com',
          { reason: 'bad_password' },
        );
      },
    );

    const row = repoCreate.mock.calls[0][0] as Partial<AuditLog>;
    expect(row).toMatchObject({
      action: 'LOGIN_FAILED',
      outcome: 'FAILURE',
      actorId: null,
      actorEmail: 'attempted@example.com',
      metadata: { reason: 'bad_password' },
    });
  });

  it('records admin actions with resource coordinates', async () => {
    await service.adminAction(
      AuditAction.WORKSPACE_DELETED,
      { id: 'admin-1' },
      'Workspace',
      'ws-1',
    );

    const row = repoCreate.mock.calls[0][0] as Partial<AuditLog>;
    expect(row).toMatchObject({
      action: 'WORKSPACE_DELETED',
      outcome: 'SUCCESS',
      actorId: 'admin-1',
      resourceType: 'Workspace',
      resourceId: 'ws-1',
    });
  });

  it('falls back to a console warning when no repository is wired', async () => {
    const bareService = new AuditService(undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await bareService.log({
        action: AuditAction.REGISTER,
        actor: { email: 'foo@bar.com' },
      });
      expect(result).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('swallows repository errors so audit failures never break requests', async () => {
    repoSave.mockRejectedValueOnce(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await service.log({ action: AuditAction.REGISTER });
      expect(result).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
