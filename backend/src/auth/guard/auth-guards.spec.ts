import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

// Unit tests for the authentication (JwtAuthGuard) and authorization
// (RolesGuard) guards. Both are instantiated directly, with no Nest
// testing module, since they have few or no dependencies
describe('Authentication & Authorization Guards (#53 BE-45)', () => {
  describe('JwtAuthGuard', () => {
    let guard: JwtAuthGuard;

    // Fresh guard instance before each test
    beforeEach(() => {
      guard = new JwtAuthGuard();
    });

    it('should return user when validate request succeeds without error', () => {
      const user = { id: 'usr_123', email: 'test@oraculum.app' };
      // handleRequest(err, user, info) is the hook Passport's AuthGuard calls
      // after the JWT strategy runs: no error and a user means success
      const result = guard.handleRequest(null, user, null);

      // The user is returned as-is, and Nest attaches it to req.user
      expect(result).toEqual(user);
    });

    it('should throw UnauthorizedException when passport error or user is missing', () => {
      // Case 1: Passport reports an error (e.g. an expired token),
      // which should become a 401
      expect(() => guard.handleRequest(new Error('JWT expired'), null, null)).toThrow(
        UnauthorizedException,
      );
      // Case 2: no error but also no user (e.g. no token was sent),
      // which should also become a 401
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('RolesGuard', () => {
    let guard: RolesGuard;
    // Typed mock so getAllAndOverride's return value can be controlled per test
    let reflector: jest.Mocked<Reflector>;

    beforeEach(() => {
      // Only the one Reflector method the guard uses is mocked;
      // `as any` skips implementing the rest of the class
      reflector = {
        getAllAndOverride: jest.fn(),
      } as any;

      // Inject the mocked reflector straight into the guard's constructor
      guard = new RolesGuard(reflector);
    });

    // Helper that builds a minimal fake ExecutionContext containing a request
    // with the given user (or null for an unauthenticated request)
    function createMockContext(user: any): ExecutionContext {
      return {
        // The guard passes these to the reflector to read @Roles() metadata;
        // since the reflector is mocked, they don't need real values
        getHandler: jest.fn(),
        getClass: jest.fn(),
        // Mimics ctx.switchToHttp().getRequest() returning a request with a user
        switchToHttp: () => ({
          getRequest: () => ({ user }),
        }),
      } as unknown as ExecutionContext;
    }

    it('should allow access if no roles are required on route handler', () => {
      // No @Roles() metadata on the route, so the route is open to any role
      reflector.getAllAndOverride.mockReturnValue(null);
      const context = createMockContext({ role: 'USER' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should grant access if user possesses required role', () => {
      // The route accepts either ADMIN or SUPER_ADMIN; the user is an ADMIN
      reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'SUPER_ADMIN']);
      const context = createMockContext({ role: 'ADMIN' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException if user lacks mandatory role', () => {
      // The route requires ADMIN, but the user only has the USER role,
      // so the guard responds with a 403
      reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
      const context = createMockContext({ role: 'USER' });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if user context is missing from request', () => {
      // A role is required but there's no user on the request, e.g. the
      // JWT guard didn't run first. The guard denies access instead of crashing
      reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
      const context = createMockContext(null);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});