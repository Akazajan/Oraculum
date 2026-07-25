import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { InvitationStatus, WorkspaceRole } from '@prisma/client';

describe('WorkspaceInvitationsService', () => {
  let service: WorkspaceInvitationsService;
  let prisma: any;
  let emailService: any;

  beforeEach(async () => {
    prisma = {
      workspaceMember: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      workspaceInvitation: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    emailService = {
      sendWorkspaceInvitationEmail: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceInvitationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<WorkspaceInvitationsService>(WorkspaceInvitationsService);
  });

  it('should successfully create and send invitation when requested by owner', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: 'OWNER',
      workspace: { name: 'Acme Corp' },
    });
    prisma.workspaceMember.findFirst.mockResolvedValue(null);
    prisma.workspaceInvitation.findFirst.mockResolvedValue(null);
    prisma.workspaceInvitation.create.mockResolvedValue({
      id: 'inv-1',
      token: 'uuid-token',
      email: 'invitee@example.com',
      status: InvitationStatus.PENDING,
    });

    const result = await service.createInvitation('ws-1', 'owner-1', {
      email: 'invitee@example.com',
    });

    expect(result.id).toBe('inv-1');
    expect(emailService.sendWorkspaceInvitationEmail).toHaveBeenCalled();
  });

  it('should reject invitation creation if inviter is non-admin member', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      role: 'MEMBER',
      workspace: { name: 'Acme Corp' },
    });

    await expect(
      service.createInvitation('ws-1', 'member-1', { email: 'invitee@example.com' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should transition status to ACCEPTED and create workspace membership', async () => {
    const mockInvitation = {
      id: 'inv-1',
      workspaceId: 'ws-1',
      email: 'invitee@example.com',
      role: WorkspaceRole.MEMBER,
      status: InvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 10000),
    };

    prisma.workspaceInvitation.findUnique.mockResolvedValue(mockInvitation);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2', email: 'invitee@example.com' });
    prisma.workspaceInvitation.update.mockResolvedValue({
      ...mockInvitation,
      status: InvitationStatus.ACCEPTED,
    });

    const res = await service.acceptInvitation('uuid-token', 'user-2');

    expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
      data: { workspaceId: 'ws-1', userId: 'user-2', role: WorkspaceRole.MEMBER },
    });
    expect(res.status).toBe(InvitationStatus.ACCEPTED);
  });
});