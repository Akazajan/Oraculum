import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole, ROLE_HIERARCHY } from '../../users/enums/userRoles.enum';

const ctx = (role?: string) =>
  ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);
  const roles = Object.values(UserRole);

  it('has a hierarchy entry for every role', () => {
    expect(Object.keys(ROLE_HIERARCHY).sort()).toEqual([...roles].sort());
  });

  it.each(roles)('%s follows the hierarchy for every required role', (role) => {
    for (const required of roles) {
      reflector.getAllAndOverride.mockReturnValue([required]);
      if (ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required]) {
        expect(guard.canActivate(ctx(role))).toBe(true);
      } else {
        expect(() => guard.canActivate(ctx(role))).toThrow(ForbiddenException);
      }
    }
  });

  it('rejects an unknown role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.USER]);
    expect(() => guard.canActivate(ctx('hacker'))).toThrow(ForbiddenException);
  });
});