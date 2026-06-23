import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'authz:permissions';

export interface PermissionRequirement {
  /** Caller must hold ALL of these. */
  all?: string[];
  /** Caller must hold AT LEAST ONE of these. */
  any?: string[];
}

/**
 * Require that the caller holds ALL of the given permission keys.
 * @example @RequirePermissions('role.view', 'role.edit')
 */
export const RequirePermissions = (...all: string[]) =>
  SetMetadata(PERMISSIONS_KEY, { all } as PermissionRequirement);

/**
 * Require that the caller holds AT LEAST ONE of the given permission keys.
 * @example @RequireAnyPermission('report.view', 'report.export')
 */
export const RequireAnyPermission = (...any: string[]) =>
  SetMetadata(PERMISSIONS_KEY, { any } as PermissionRequirement);

/** Combine ALL + ANY requirements on a single handler. */
export const RequirePermissionSet = (requirement: PermissionRequirement) =>
  SetMetadata(PERMISSIONS_KEY, requirement);
