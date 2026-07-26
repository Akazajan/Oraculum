import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { InvitationStatus, WorkspaceRole } from '@prisma/client';

export interface CreateInvitationDto {
  email: string;
  role?: WorkspaceRole;
}

@Injectable()
export class WorkspaceInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Invites a user to join a workspace by email.
   */
  async createInvitation(
    workspaceId: string,
    inviterId: string,
    dto: CreateInvitationDto,
  ) {
    // 1. Check workspace existence and inviter authority (Owner or Admin)
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: inviterId },
      },
      include: { workspace: true },
    });

    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new ForbiddenException(
        'Only workspace owners or admins can invite new members.',
      );
    }

    const recipientEmail = dto.email.toLowerCase().trim();

    // 2. Check if user is already a member
    const existingMember = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        user: { email: recipientEmail },
      },
    });

    if (existingMember) {
      throw new ConflictException(
        'User is already a member of this workspace.',
      );
    }

    // 3. Check for existing pending invitation
    const existingInvitation = await this.prisma.workspaceInvitation.findFirst(
      {
        where: {
          workspaceId,
          email: recipientEmail,
          status: InvitationStatus.PENDING,
        },
      },
    );

    if (existingInvitation) {
      throw new ConflictException(
        'A pending invitation already exists for this email.',
      );
    }

    // 4. Create workspace invitation record
    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        workspaceId,
        inviterId,
        email: recipientEmail,
        role: dto.role || WorkspaceRole.MEMBER,
        status: InvitationStatus.PENDING,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days expiry
      },
    });

    // 5. Send email notification asynchronously
    await this.emailService.sendWorkspaceInvitationEmail({
      to: recipientEmail,
      workspaceName: membership.workspace.name,
      inviterName: inviterId,
      invitationToken: invitation.token,
    });

    return invitation;
  }

  /**
   * Accepts a pending workspace invitation.
   */
  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.validateInvitationToken(token);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address.',
      );
    }

    // Process acceptance in a database transaction
    return this.prisma.$transaction(async (tx) => {
      // Create membership record
      await tx.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
      });

      // Mark invitation status as ACCEPTED
      return tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      });
    });
  }

  /**
   * Declines a pending workspace invitation.
   */
  async declineInvitation(token: string, userId: string) {
    const invitation = await this.validateInvitationToken(token);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address.',
      );
    }

    return this.prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.DECLINED },
    });
  }

  /**
   * Helper to validate token freshness and status.
   */
  private async validateInvitationToken(token: string) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation token is invalid or expired.');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Invitation has already been ${invitation.status.toLowerCase()}.`,
      );
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException('Invitation link has expired.');
    }

    return invitation;
  }
}