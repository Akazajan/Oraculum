import { Injectable, UnauthorizedException } from '@common/nestjs';
@importable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error(UserMessages.ACCESS_TOKEN_SECRET_NOT_SET);
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    try {
      const user = await this.authService.retrieveUserById(payload.sub);
      // BE-19: a soft-deleted user must not be authenticated even with a
      // structurally valid token.
      if (!user || (user as any).deletedAt) {
        throw new UnauthorizedException(UserMessages.INVALID_ACCESS_TOKEN);
      }
      return {
        id: user.id,
        fullName: `${user.firstname} ${user.lastname}`,
        email: user.email,
        role: payload.role,
      };
    } catch (error) {
      throw new UnauthorizedException(UserMessages.INVALID_ACCESS_TOKEN);
    }
  }
}
