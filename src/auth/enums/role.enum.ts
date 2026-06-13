/**
 * Role Enum
 * Defines all available user roles in the system
 */
export enum Role {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  HOD = 'HOD',
  LEAD = 'LEAD',
  ASSOCIATE = 'ASSOCIATE',
}

/**
 * Role hierarchy levels (higher number = more privileges)
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.SUPERADMIN]: 5,
  [Role.ADMIN]: 4,
  [Role.HOD]: 3,
  [Role.LEAD]: 2,
  [Role.ASSOCIATE]: 1,
};

/**
 * Roles that can be managed by each role
 */
export const MANAGEABLE_ROLES: Record<Role, Role[]> = {
  [Role.SUPERADMIN]: [
    Role.SUPERADMIN,
    Role.ADMIN,
    Role.HOD,
    Role.LEAD,
    Role.ASSOCIATE,
  ],
  [Role.ADMIN]: [Role.ADMIN, Role.HOD, Role.LEAD, Role.ASSOCIATE],
  [Role.HOD]: [Role.HOD, Role.LEAD, Role.ASSOCIATE],
  [Role.LEAD]: [Role.LEAD, Role.ASSOCIATE],
  [Role.ASSOCIATE]: [Role.ASSOCIATE],
};
