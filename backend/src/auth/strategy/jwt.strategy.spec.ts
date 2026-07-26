import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

describe('JwtStrategy Unit Tests (#53 BE-45)', () => {
  let strategy: JwtStrategy;
  let usersService: jest.Mocked<Partial<UsersService>>;

  const mockUser = {
    id: 'usr_123',
    email: 'dev@oraculum.app',
    role: 'ADMIN',
    isActive: true,
  };

  beforeEach(() => {
    usersService = {
      findById: jest.fn(),
    };

    strategy = new JwtStrategy(usersService as any, {
      jwtSecret: 'test-secret-key-12345',
    });
  });

  describe('validate()', () => {
    it('should return user object when payload is valid and user exists & active', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);

      const payload = { sub: 'usr_123', email: 'dev@oraculum.app', role: 'ADMIN' };
      const result = await strategy.validate(payload);

      expect(usersService.findById).toHaveBeenCalledWith('usr_123');
      expect(result).toEqual(mockUser);
    });

    it('should throw UnauthorizedException if user is not found in database', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(null);

      const payload = { sub: 'usr_nonexistent', email: 'missing@oraculum.app' };

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(usersService.findById).toHaveBeenCalledWith('usr_nonexistent');
    });

    it('should throw UnauthorizedException if user account is deactivated', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue({
        ...mockUser,
        isActive: false,
      });

      const payload = { sub: 'usr_123', email: 'dev@oraculum.app' };

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});