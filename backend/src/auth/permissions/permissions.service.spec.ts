import { PermissionsService } from './permissions.service';
import { GlobalRole, WorkspaceRole, Permission } from './role-permissions.matrix';

describe('PermissionsService (#51 BE-43)', () => {
  let service: PermissionsService;

  beforeEach(() => {
    service = new PermissionsService();
  });

  describe('Global Role Evaluation', () => {
    it('should grant SUPER_ADMIN all permissions', () => {
      expect(
        service.hasPermission(Permission.MANAGE_SYSTEM_SETTINGS, GlobalRole.SUPER_ADMIN),
      ).toBe(true);
      expect(
        service.hasPermission(Permission.WORKSPACE_DELETE, GlobalRole.SUPER_ADMIN),
      ).toBe(true);
    });

    it('should deny regular USER administrative actions', () => {
      expect(
        service.hasPermission(Permission.MANAGE_USERS, GlobalRole.USER),
      ).toBe(false);
    });
  });

  describe('Workspace Role Evaluation', () => {
    it('should allow OWNER to delete workspace but deny MEMBER', () => {
      expect(
        service.hasPermission(Permission.WORKSPACE_DELETE, WorkspaceRole.OWNER),
      ).toBe(true);
      expect(
        service.hasPermission(Permission.WORKSPACE_DELETE, WorkspaceRole.MEMBER),
      ).toBe(false);
    });

    it('should allow MEMBER to invite users but deny GUEST', () => {
      expect(
        service.hasPermission(Permission.WORKSPACE_MEMBER_INVITE, WorkspaceRole.MEMBER),
      ).toBe(true);
      expect(
        service.hasPermission(Permission.WORKSPACE_MEMBER_INVITE, WorkspaceRole.GUEST),
      ).toBe(false);
    });
  });
});