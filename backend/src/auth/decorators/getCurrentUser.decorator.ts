import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Parameter decorator that injects the authenticated user (or one of its
// properties) into a controller method:
//   @GetCurrentUser() user           -> the whole user object
//   @GetCurrentUser('email') email   -> just user.email
export const GetCurrentUser = createParamDecorator(
  // `data` is the optional property name passed to the decorator
  (data: string | undefined, ctx: ExecutionContext) => {
    // Get the underlying HTTP request from the execution context.
    // The generic types `request.user` as an optional record, since it's
    // not typed by default
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: Record<string, unknown> }>();
    // req.user is populated by an auth guard (e.g. JwtAuthGuard) earlier in
    // the request lifecycle; it will be undefined on unguarded routes
    const user = request.user;
    // If a property name was given, return just that field (optional chaining
    // avoids a crash when there is no user); otherwise return the whole user
    return data ? user?.[data] : user;
  },
);

// Shortcut decorator that injects only the authenticated user's id:
//   @GetCurrentUserId() userId: string
export const GetCurrentUserId = createParamDecorator(
  // No argument is accepted, so `_data` is unused (underscore prefix marks that)
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: { id?: string } }>();
    // Returns undefined if the route isn't protected by an auth guard
    // or the user has no id
    return request.user?.id;
  },
);