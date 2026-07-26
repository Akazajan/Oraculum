export enum GlobalRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  GUEST = 'GUEST',
}

export enum Permission {
  // System / Admin Permissions
  MANAGE_USERS = 'manage:users',
  VIEW_AUDIT_LOGS = 'view:audit_logs',
  MANAGE_SYSTEM_SETTINGS = 'manage:system_settings',

  // Workspace Permissions
  WORKSPACE_DELETE = 'workspace:delete',
  WORKSPACE_UPDATE = 'workspace:update',
  WORKSPACE_MEMBER_INVITE = 'workspace:member:invite',
  WORKSPACE_MEMBER_REMOVE = 'workspace:member:remove',
  WORKSPACE_ROLE_UPDATE = 'workspace:role:update',
  WORKSPACE_VIEW = 'workspace:view',
}

/**
 * Explicit mapping of Global Roles to System Permissions
 */
export const GLOBAL_ROLE_PERMISSIONS: Record<GlobalRole, Permission[]> = {
  [GlobalRole.SUPER_ADMIN]: Object.values(Permission),
  [GlobalRole.ADMIN]: [
    Permission.MANAGE_USERS,
    Permission.VIEW_AUDIT_LOGS,
    Permission.WORKSPACE_VIEW,
  ],
  [GlobalRole.USER]: [],
};

/**
 * Explicit mapping of Workspace Roles to Workspace-level Permissions
 */
export const WORKSPACE_ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
  [WorkspaceRole.OWNER]: [
    Permission.WORKSPACE_DELETE,
    Permission.WORKSPACE_UPDATE,
    Permission.WORKSPACE_MEMBER_INVITE,
    Permission.WORKSPACE_MEMBER_REMOVE,
    Permission.WORKSPACE_ROLE_UPDATE,
    Permission.WORKSPACE_VIEW,
  ],
  [WorkspaceRole.ADMIN]: [
    Permission.WORKSPACE_UPDATE,
    Permission.WORKSPACE_MEMBER_INVITE,
    Permission.WORKSPACE_MEMBER_REMOVE,
    Permission.WORKSPACE_VIEW,
  ],
  [WorkspaceRole.MEMBER]: [
    Permission.WORKSPACE_MEMBER_INVITE,
    Permission.WORKSPACE_VIEW,
  ],
  [WorkspaceRole.GUEST]: [
    Permission.WORKSPACE_VIEW,
  ],
};