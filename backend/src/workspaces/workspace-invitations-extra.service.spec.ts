import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ForbiddenException, ConflictException } from '@nestjs/common';

describe('WorkspaceInvitationsService - additional coverage', () => {
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
    emailService = { sendWorkspaceInvitationEmail: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceInvitationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();
    service = module.get<WorkspaceInvitationsService>(WorkspaceInvitationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw ForbiddenException when inviter is not a workspace member', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    await expect(
      service.invite('ws-1', 'inviter-1', { email: 'guest@example.com', role: 'MEMBER' } as any),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw ConflictException when invitation already pending', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER', workspace: { name: 'Test' } });
    prisma.workspaceInvitation.findFirst.mockResolvedValue({ id: 'inv-1', status: 'PENDING' });
    await expect(
      service.invite('ws-1', 'inviter-1', { email: 'guest@example.com', role: 'MEMBER' } as any),
    ).rejects.toThrow(ConflictException);
  });
});