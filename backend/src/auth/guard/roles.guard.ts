import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorators';
import { UserRole, ROLE_HIERARCHY } from '../../users/enums/userRoles.enum';

//role hierarchy mapping



@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: UserRole } }>();
    const { user } = request;

    if (!user) {
      throw new ForbiddenException('user not authenticated');
    }

    const userLevel = ROLE_HIERARCHY[user.role as UserRole] ?? 0;
    const hasRequiredRole = requiredRoles.some(
      (role) => userLevel >= ROLE_HIERARCHY[role],
    );

    if (!hasRequiredRole) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }
    return true;
  }
}
