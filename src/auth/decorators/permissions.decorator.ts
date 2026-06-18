import { SetMetadata } from '@nestjs/common';
import { UserPermission } from '../permissions/user-permission.policy';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require one or more permissions for a route. Enforced by PermissionGuard.
 *
 * @example
 * ```ts
 * @RequirePermissions(UserPermission.VIEW)
 * @Post('query')
 * query() { ... }
 * ```
 */
export const RequirePermissions = (...permissions: UserPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
