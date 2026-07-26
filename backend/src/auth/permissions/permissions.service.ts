import { Injectable } from '@nestjs/common';
import {
  GlobalRole,
  WorkspaceRole,
  Permission,
  GLOBAL_ROLE_PERMISSIONS,
  WORKSPACE_ROLE_PERMISSIONS,
} from './role-permissions.matrix';

@Injectable()
export class PermissionsService {
  /**
   * Checks if a global or workspace role grants a specific required permission.
   */
  hasPermission(
    requiredPermission: Permission,
    role: GlobalRole | WorkspaceRole,
  ): boolean {
    let allowedPermissions: Permission[] = [];

    if (Object.values(GlobalRole).includes(role as GlobalRole)) {
      allowedPermissions = GLOBAL_ROLE_PERMISSIONS[role as GlobalRole] || [];
    } else if (Object.values(WorkspaceRole).includes(role as WorkspaceRole)) {
      allowedPermissions = WORKSPACE_ROLE_PERMISSIONS[role as WorkspaceRole] || [];
    }

    return allowedPermissions.includes(requiredPermission);
  }
}