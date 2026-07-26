import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('Authentication & Authorization Guards (#53 BE-45)', () => {
  describe('JwtAuthGuard', () => {
    let guard: JwtAuthGuard;

    beforeEach(() => {
      guard = new JwtAuthGuard();
    });

    it('should return user when validate request succeeds without error', () => {
      const user = { id: 'usr_123', email: 'test@oraculum.app' };
      const result = guard.handleRequest(null, user, null);

      expect(result).toEqual(user);
    });

    it('should throw UnauthorizedException when passport error or user is missing', () => {
      expect(() => guard.handleRequest(new Error('JWT expired'), null, null)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('RolesGuard', () => {
    let guard: RolesGuard;
    let reflector: jest.Mocked<Reflector>;

    beforeEach(() => {
      reflector = {
        getAllAndOverride: jest.fn(),
      } as any;

      guard = new RolesGuard(reflector);
    });

    function createMockContext(user: any): ExecutionContext {
      return {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({
          getRequest: () => ({ user }),
        }),
      } as unknown as ExecutionContext;
    }

    it('should allow access if no roles are required on route handler', () => {
      reflector.getAllAndOverride.mockReturnValue(null);
      const context = createMockContext({ role: 'USER' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should grant access if user possesses required role', () => {
      reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'SUPER_ADMIN']);
      const context = createMockContext({ role: 'ADMIN' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should throw ForbiddenException if user lacks mandatory role', () => {
      reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
      const context = createMockContext({ role: 'USER' });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if user context is missing from request', () => {
      reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
      const context = createMockContext(null);

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});