import { Injectable } from '@nestjs/common';
import { CreateUserDto } from '../dto/createUser.dto';
import { UpdateUserDto } from '../dto/updateUser.dto';
import { User } from '../entities/user.entity';
import { CreateUserProvider } from './createUser.provider';
import { FindOneUserByIdProvider } from './findOneUserById.provider';
import { FindOneUserByEmailProvider } from './findOneUserByEmail.provider';
import { ValidateUserProvider } from './validateUser.provider';
import { FindAllUsersProvider } from './findAllUsers.provider';
import { UpdateUserProvider } from './updateUser.provider';
import { DeleteUserProvider } from './deleteUser.provider';
import { AuthResponse } from '../../auth/interface/authResponse.interface';
import { Response } from 'express';
import { NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadProfilePictureProvider } from './uploadProfilePicture.provider';
import { UserRole } from '../enums/userRoles.enum';
import { ForgotPasswordProvider } from './forgotPassword.provider';
import { ResetPasswordProvider } from './resetPassword.provider';
import { FindAllAdminsProvider } from './findAllAdmins.provider';
import { FindAdminByIdProvider } from './findAdminById.provider';
import { GetMembersProvider } from './get-members.provider';
import { UpdateMemberStatusProvider } from './update-member-status.provider';
import { GetMemberStatsProvider } from './get-member-stats.provider';
import { MemberQueryDto } from '../dto/member-query.dto';
import { MembershipStatus } from '../enums/membership-status.enum';
import { computeProfileCompleteness } from '../utils/profile-completeness.util';
import { AuditAction, AuditService } from '../../audit/audit.service';

@Injectable()
export class UsersService {
  async updateTwoFactor(userId: string, data: { twoFactorEnabled: boolean }) {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.twoFactorEnabled = data.twoFactorEnabled;
    return await this.usersRepository.save(user);
  }
  constructor(
    private readonly createUserProvider: CreateUserProvider,
    private readonly findOneUserByIdProvider: FindOneUserByIdProvider,
    private readonly findOneUserByEmailProvider: FindOneUserByEmailProvider,
    private readonly validateUserProvider: ValidateUserProvider,

    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly findAllUsersProvider: FindAllUsersProvider,
    private readonly updateUserProvider: UpdateUserProvider,
    private readonly deleteUserProvider: DeleteUserProvider,

    private readonly uploadProfilePictureProvider: UploadProfilePictureProvider,

    private readonly forgotPasswordProvider: ForgotPasswordProvider,
    private readonly resetPasswordProvider: ResetPasswordProvider,

    private readonly findAllAdminsProvider: FindAllAdminsProvider,
    private readonly findAdminByIdProvider: FindAdminByIdProvider,
    private readonly getMembersProvider: GetMembersProvider,
    private readonly updateMemberStatusProvider: UpdateMemberStatusProvider,
    private readonly getMemberStatsProvider: GetMemberStatsProvider,
    private readonly auditService: AuditService,
  ) {}

  // CREATE USER
  async createUser(
    createUserDto: CreateUserDto,
    response: Response,
  ): Promise<AuthResponse> {
    return await this.createUserProvider.createUser(createUserDto, response);
  }

  // FIND ALL USERS
  async findAllUsers(): Promise<User[]> {
    return await this.findAllUsersProvider.getUsers();
  }

  async findAllUsersIncludingDeleted(): Promise<User[]> {
    return await this.findAllUsersProvider.getUsers(true);
  }

  // FIND ALL ADMINS
  async findAllAdmins(): Promise<User[]> {
    return await this.findAllAdminsProvider.getAdmins();
  }

  // FIND USER BY ID
  async findUserById(id: string, withDeleted = false): Promise<User> {
    return await this.findOneUserByIdProvider.getUser(id, withDeleted);
  }

  // FIND ADMIN BY ID
  async findAdminById(id: string): Promise<User> {
    return await this.findAdminByIdProvider.getAdmin(id);
  }

  // FIND USER BY EMAIL
  async findUserByEmail(email: string): Promise<User> {
    return await this.findOneUserByEmailProvider.getUser(email);
  }

  // FIND USER BY VERIFICATION TOKEN
  async findByVerificationToken(token: string): Promise<User> {
    return await this.usersRepository.findOne({
      where: { verificationToken: token },
    });
  }

  // FIND USER BY PASSWORD RESET TOKEN
  async findByPasswordResetToken(token: string): Promise<User> {
    return await this.usersRepository.findOne({
      where: { passwordResetToken: token },
    });
  }

  // UPDATE USER
  async updateUser(id: string, updateData: UpdateUserDto): Promise<User> {
    const previous = await this.findUserById(id);
    const updated = await this.updateUserProvider.updateUser(id, updateData);

    // BE-03 — Emit a role-change audit row when only the `role` field
    // changed. Captures both the old and new role so the trace is
    // complete.
    if (
      updateData.role !== undefined &&
      previous.role !== updated.role
    ) {
      await this.auditService.adminAction(
        AuditAction.ROLE_CHANGED,
        {}, // actor comes from the ALS context
        'User',
        updated.id,
        {
          from: previous.role,
          to: updated.role,
          email: updated.email,
        },
      );
    } else if (Object.keys(updateData).length > 0) {
      await this.auditService.adminAction(
        AuditAction.USER_UPDATED,
        {},
        'User',
        updated.id,
        { email: updated.email, fields: Object.keys(updateData) },
      );
    }

    return updated;
  }

  // DELETE USER
  async deleteUser(id: string): Promise<void> {
    return await this.deleteUserProvider.deleteUser(id);
  }

  // RESTORE USER
  async restoreUser(id: string): Promise<User> {
    const existing = await this.findUserById(id, true);
    if (!existing.deletedAt) {
      throw new NotFoundException(`User with ID ${id} is not deleted`);
    }
    await this.usersRepository.restore(id);
    await this.usersRepository.update(id, { isActive: true });
    await this.auditService.adminAction(
      AuditAction.USER_RESTORED,
      {},
      'User',
      id,
      { email: existing.email },
    );
    return await this.findUserById(id);
  }

  // VALIDATE USER
  async validateUser(email: string, password: string): Promise<Partial<User>> {
    return await this.validateUserProvider.validateUser(email, password);
  }

  // UPDATE PROFILE PICTURE (delegates to provider)
  async uploadUserProfilePicture(
    targetUserId: string,
    file: Express.Multer.File,
    currentUserId: string,
    currentUserRole: UserRole,
  ): Promise<{ id: string; profilePicture: string }> {
    try {
      const result = await this.uploadProfilePictureProvider.uploadProfilePicture(
        targetUserId,
        file,
        currentUserId,
        currentUserRole,
      );
      await this.auditService.adminAction(
        AuditAction.PROFILE_PICTURE_UPDATED,
        { id: currentUserId, role: currentUserRole },
        'User',
        targetUserId,
      );
      return result;
    } catch (err) {
      await this.auditService.log({
        action: AuditAction.PROFILE_PICTURE_FAILED,
        outcome: 'FAILURE',
        actor: { id: currentUserId, role: currentUserRole },
        resourceType: 'User',
        resourceId: targetUserId,
        metadata: { reason: (err as Error)?.message },
      });
      throw err;
    }
  }

  // UPDATE PROFILE PICTURE (legacy save method if needed elsewhere)
  async updateProfilePicture(
    userId: string,
    profilePictureUrl: string,
  ): Promise<User & { oldProfilePicture?: string }> {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const oldProfilePicture = user.profilePicture;
    user.profilePicture = profilePictureUrl;
    const updatedUser = await this.usersRepository.save(user);
    return { ...updatedUser, oldProfilePicture } as User & {
      oldProfilePicture?: string;
    };
  }

  // FIND ONE BY ID (EXCLUDE PASSWORD) - service-level method for controller
  async findOnePublicById(id: string): Promise<Partial<User>> {
    const user = await this.findUserById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { password, ...userWithoutPassword } = user as any;
    return userWithoutPassword;
  }

  // FORGOT PASSWORD
  async forgotPassword(email: string) {
    return await this.forgotPasswordProvider.execute(email);
  }

  // RESET PASSWORD
  async resetPassword(token: string, newPassword: string) {
    return await this.resetPasswordProvider.execute(token, newPassword);
  }

  // MEMBERS
  async getMembers(query: MemberQueryDto, withDeleted = false) {
    return this.getMembersProvider.getMembers(query, withDeleted);
  }

  async updateMemberStatus(memberId: string, status: MembershipStatus) {
    const updated = await this.updateMemberStatusProvider.updateStatus(
      memberId,
      status,
    );
    await this.auditService.adminAction(
      AuditAction.MEMBERSHIP_STATUS_CHANGED,
      {},
      'User',
      memberId,
      {
        status,
        email: updated.email,
      },
    );
    return updated;
  }

  async getMemberStats() {
    return this.getMemberStatsProvider.getStats();
  }

  async getMemberProfile(userId: string) {
    const user = await this.findUserById(userId);
    const completeness = computeProfileCompleteness(user);
    if (user.profileCompleteness !== completeness) {
      await this.usersRepository.update(user.id, {
        profileCompleteness: completeness,
      });
      user.profileCompleteness = completeness;
    }
    return user;
  }
}
