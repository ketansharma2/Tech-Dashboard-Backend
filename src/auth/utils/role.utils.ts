import { Role, ROLE_HIERARCHY, MANAGEABLE_ROLES } from '../enums/role.enum';

/**
 * Check if a user role has permission to access a required role
 * @param userRole - The role of the user making the request
 * @param requiredRole - The minimum role required for access
 * @returns true if user has sufficient privileges
 */
export function hasRolePermission(
  userRole: Role,
  requiredRole: Role,
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if a user can manage another user based on their roles
 * @param managerRole - The role of the user attempting to manage
 * @param targetRole - The role of the user being managed
 * @returns true if manager can manage the target
 */
export function canManageRole(managerRole: Role, targetRole: Role): boolean {
  return MANAGEABLE_ROLES[managerRole].includes(targetRole);
}

/**
 * Get all roles that a user can manage
 * @param userRole - The role of the user
 * @returns Array of manageable roles
 */
export function getManageableRoles(userRole: Role): Role[] {
  return MANAGEABLE_ROLES[userRole];
}

/**
 * Check if user has any of the required roles
 * @param userRole - The role of the user
 * @param requiredRoles - Array of acceptable roles
 * @returns true if user has at least one of the required roles
 */
export function hasAnyRole(userRole: Role, requiredRoles: Role[]): boolean {
  return requiredRoles.includes(userRole);
}

/**
 * Check if user has all of the required roles (useful for multi-role scenarios)
 * @param userRoles - Array of user's roles
 * @param requiredRoles - Array of required roles
 * @returns true if user has all required roles
 */
export function hasAllRoles(
  userRoles: Role[],
  requiredRoles: Role[],
): boolean {
  return requiredRoles.every((role) => userRoles.includes(role));
}
