import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../permissions/permissions.service';
import { Permission } from '../permissions/role-permissions.matrix';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user, workspaceMember } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('User context not found.');
    }

    // Check Global Role first (Super Admin override)
    const hasGlobalPermission = requiredPermissions.every((perm) =>
      this.permissionsService.hasPermission(perm, user.globalRole),
    );

    if (hasGlobalPermission) {
      return true;
    }

    // Fall back to Workspace Role evaluation if workspace member context is present
    if (workspaceMember) {
      const hasWorkspacePermission = requiredPermissions.every((perm) =>
        this.permissionsService.hasPermission(perm, workspaceMember.role),
      );

      if (hasWorkspacePermission) {
        return true;
      }
    }

    throw new ForbiddenException(
      'Insufficient permissions to perform this action.',
    );
  }
}