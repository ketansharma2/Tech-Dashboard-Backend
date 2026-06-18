import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Role as AuthRole } from '../enums/role.enum';
import { canManageRole } from '../utils/role.utils';
import { UserActionType } from '../../users/dto/user-action.dto';

/**
 * Centralized User Management permission model.
 *
 * This is the SINGLE source of truth for "who can do what" with users. Both the
 * PermissionGuard (route layer) and UserActionService (business layer) consume
 * it — no role checks are hardcoded in controllers or scattered in handlers.
 */
export enum UserPermission {
  VIEW = 'user:view',
  CREATE = 'user:create',
  UPDATE = 'user:update',
  DELETE = 'user:delete',
  ACTIVATE = 'user:activate',
  DEACTIVATE = 'user:deactivate',
  RESET_PASSWORD = 'user:reset_password',
  ASSIGN_ROLE = 'user:assign_role',
  ASSIGN_DEPARTMENT = 'user:assign_department',
  ASSIGN_MANAGER = 'user:assign_manager',
}

const ALL_PERMISSIONS = Object.values(UserPermission);

/**
 * Role → permission grants.
 *  - SUPERADMIN: everything (incl. role assignment, delete, managing admins).
 *  - ADMIN: full user management EXCEPT delete and role assignment; can never
 *    touch a SUPERADMIN (enforced separately via canManageRole).
 *  - HOD / LEAD: read-only (their visibility is scoped in UserQueryService).
 *  - ASSOCIATE: no access at all.
 */
export const ROLE_PERMISSIONS: Record<Role, UserPermission[]> = {
  SUPERADMIN: ALL_PERMISSIONS,
  ADMIN: [
    UserPermission.VIEW,
    UserPermission.CREATE,
    UserPermission.UPDATE,
    UserPermission.ACTIVATE,
    UserPermission.DEACTIVATE,
    UserPermission.RESET_PASSWORD,
    UserPermission.ASSIGN_DEPARTMENT,
    UserPermission.ASSIGN_MANAGER,
  ],
  HOD: [UserPermission.VIEW],
  LEAD: [UserPermission.VIEW],
  ASSOCIATE: [],
};

/** Maps each action to the permission it requires. */
export const ACTION_PERMISSION: Record<UserActionType, UserPermission> = {
  [UserActionType.CREATE_USER]: UserPermission.CREATE,
  [UserActionType.UPDATE_USER]: UserPermission.UPDATE,
  [UserActionType.DELETE_USER]: UserPermission.DELETE,
  [UserActionType.ACTIVATE_USER]: UserPermission.ACTIVATE,
  [UserActionType.DEACTIVATE_USER]: UserPermission.DEACTIVATE,
  [UserActionType.RESET_PASSWORD]: UserPermission.RESET_PASSWORD,
  [UserActionType.ASSIGN_ROLE]: UserPermission.ASSIGN_ROLE,
  [UserActionType.ASSIGN_DEPARTMENT]: UserPermission.ASSIGN_DEPARTMENT,
  [UserActionType.ASSIGN_MANAGER]: UserPermission.ASSIGN_MANAGER,
};

export function getRolePermissions(role: Role): UserPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: UserPermission): boolean {
  return getRolePermissions(role).includes(permission);
}

export function permissionForAction(action: UserActionType): UserPermission {
  return ACTION_PERMISSION[action];
}

/** Throws unless the actor's role is granted the permission. */
export function assertPermission(role: Role, permission: UserPermission): void {
  if (!roleHasPermission(role, permission)) {
    throw new ForbiddenException(
      `Your role (${role}) does not have the '${permission}' permission`,
    );
  }
}

/**
 * Throws unless the actor may manage a user of `targetRole`. Reuses the existing
 * role hierarchy (MANAGEABLE_ROLES) so e.g. ADMIN can never act on a SUPERADMIN.
 * The two enums share identical string values; the cast bridges their types.
 */
export function assertCanManageRole(actorRole: Role, targetRole: Role): void {
  if (!canManageRole(actorRole as unknown as AuthRole, targetRole as unknown as AuthRole)) {
    throw new ForbiddenException(
      `Your role (${actorRole}) cannot manage a ${targetRole} user`,
    );
  }
}
