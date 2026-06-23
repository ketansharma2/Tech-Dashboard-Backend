import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PermissionRequirement,
} from './permissions.decorator';
import { PermissionResolverService } from './permission-resolver.service';

/**
 * Dynamic, DB-backed permission guard. Runs after the global JwtAuthGuard so
 * `req.user` is populated, resolves the caller's EFFECTIVE permissions, and
 * enforces the @RequirePermissions / @RequireAnyPermission requirement.
 *
 * The resolved set is stashed on the request (`req.effectivePermissions`) so
 * services/controllers can reuse it without re-resolving.
 */
@Injectable()
export class DynamicPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private resolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement || (!requirement.all?.length && !requirement.any?.length)) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId) {
      throw new ForbiddenException('Authentication required');
    }

    const effective = await this.resolver.getEffectivePermissions(user.userId);
    req.effectivePermissions = effective;

    const okAll = requirement.all?.length
      ? requirement.all.every((k) => effective.has(k))
      : true;
    const okAny = requirement.any?.length
      ? requirement.any.some((k) => effective.has(k))
      : true;

    if (!okAll || !okAny) {
      const needed = [...(requirement.all ?? []), ...(requirement.any ?? [])];
      throw new ForbiddenException(
        `Access denied. Required permission(s): ${needed.join(', ')}`,
      );
    }

    return true;
  }
}
