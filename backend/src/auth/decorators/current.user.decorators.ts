import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../users/entities/user.entity';

// Custom parameter decorator that injects the authenticated user into a
// controller method, e.g. `getProfile(@CurrentUser() user: User)`.
// This replaces the repetitive `@Req() req` / `req.user` pattern
export const CurrentUser = createParamDecorator(
  // `data` is any argument passed to the decorator, e.g. @CurrentUser('id').
  // It's unused here, so it's typed as unknown
  (data: unknown, ctx: ExecutionContext): User => {
    // Get the underlying HTTP request from the execution context.
    // The generic types `request.user` as a User (it's not typed by default)
    const request = ctx.switchToHttp().getRequest<{ user: User }>();
    // req.user is populated by an auth guard (e.g. JwtAuthGuard) earlier in
    // the request lifecycle, so the route must be protected by that guard.
    // Without it, this returns undefined despite the User return type
    return request.user;
  },
);