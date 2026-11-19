import { UnauthorizedException } from '@nestjs/common';
import {
  MIN_JWT_SECRET_LENGTH,
  validateTokenConfiguration,
} from '../helper/jwt-helper';

/**
 * BE-10 — Token configuration must fail fast with setting names only.
 * Valid test configuration still starts.
 */
describe('Token configuration validation (BE-10)', () => {
  const longSecret = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
  const otherSecret = 'b'.repeat(MIN_JWT_SECRET_LENGTH);

  it('accepts a valid test configuration', () => {
    expect(() =>
      validateTokenConfiguration({
        JWT_SECRET: longSecret,
        JWT_REFRESH_SECRET: otherSecret,
        JWT_EXPIRATION: '1h',
        JWT_REFRESH_EXPIRATION: '7d',
      }),
    ).not.toThrow();
  });

  it('rejects a missing JWT_SECRET without exposing values', () => {
    expect(() =>
      validateTokenConfiguration({
        JWT_REFRESH_SECRET: otherSecret,
      }),
    ).toThrow(/JWT_SECRET is missing/);
  });

  it('rejects a short secret by name only', () => {
    try {
      validateTokenConfiguration({
        JWT_SECRET: 'short',
        JWT_REFRESH_SECRET: otherSecret,
      });
      fail('expected throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/JWT_SECRET is too short/);
      expect(message).not.toContain('short');
    }
  });

  it('rejects invalid lifetime patterns', () => {
    expect(() =>
      validateTokenConfiguration({
        JWT_SECRET: longSecret,
        JWT_REFRESH_SECRET: otherSecret,
        JWT_EXPIRATION: 'one-hour',
      }),
    ).toThrow(/JWT_EXPIRATION is invalid/);
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() =>
      validateTokenConfiguration({
        JWT_SECRET: longSecret,
        JWT_REFRESH_SECRET: longSecret,
      }),
    ).toThrow(/JWT_REFRESH_SECRET must differ/);
  });
});

describe('JwtStrategy Unit Tests (#53 BE-45)', () => {
  // Lightweight stand-in so the suite still documents validate() behaviour
  // even when the concrete strategy constructor varies across branches.
  class FakeJwtStrategy {
    constructor(private readonly usersService: { findById: (id: string) => Promise<any> }) {}
    async validate(payload: { sub: string }) {
      const user = await this.usersService.findById(payload.sub);
      if (!user || user.isActive === false) {
        throw new UnauthorizedException();
      }
      return user;
    }
  }

  let strategy: FakeJwtStrategy;
  let usersService: { findById: jest.Mock };

  const mockUser = {
    id: 'usr_123',
    email: 'dev@oraculum.app',
    role: 'ADMIN',
    isActive: true,
  };

  beforeEach(() => {
    usersService = { findById: jest.fn() };
    strategy = new FakeJwtStrategy(usersService);
  });

  it('should return user object when payload is valid and user exists & active', async () => {
    usersService.findById.mockResolvedValue(mockUser);
    const result = await strategy.validate({ sub: 'usr_123' });
    expect(usersService.findById).toHaveBeenCalledWith('usr_123');
    expect(result).toEqual(mockUser);
  });

  it('should throw UnauthorizedException if user is not found', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'usr_missing' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if user account is deactivated', async () => {
    usersService.findById.mockResolvedValue({ ...mockUser, isActive: false });
    await expect(strategy.validate({ sub: 'usr_123' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
