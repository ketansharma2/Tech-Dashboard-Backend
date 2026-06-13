import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

/**
 * Metadata key for roles
 */
export const ROLES_KEY = 'roles';

/**
 * Roles Decorator
 * Use this decorator to specify which roles are allowed to access a route
 * 
 * @example
 * ```typescript
 * @Roles(Role.ADMIN, Role.SUPERADMIN)
 * @Get('admin-only')
 * adminOnlyRoute() {
 *   return 'Only admins can see this';
 * }
 * ```
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
