import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import {
  UserPermission,
  roleHasPermission,
} from '../permissions/user-permission.policy';

/**
 * PermissionGuard
 * Enforces fine-grained permissions declared via @RequirePermissions().
 * Runs after JwtAuthGuard (global) so req.user is populated. Reusable across
 * any feature that defines permissions in a policy.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.role) {
      throw new ForbiddenException('User role not found');
    }

    const hasAll = required.every((permission) =>
      roleHasPermission(user.role, permission),
    );

    if (!hasAll) {
      throw new ForbiddenException(
        `Access denied. Required permission(s): ${required.join(', ')}`,
      );
    }

    return true;
  }
}
