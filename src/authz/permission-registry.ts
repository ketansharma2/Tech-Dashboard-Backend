/**
 * Central, code-defined catalog of modules and their actions.
 *
 * Permissions are GENERATED from this registry (`module.action` keys) and
 * seeded into the `permissions` table. To support a new module later (CRM,
 * Invoices, HR, …) just add an entry here and re-run the seeder — the whole
 * permission engine, role UI, and guards pick it up automatically with no
 * other code changes.
 */

export interface ActionDef {
  action: string;
  label: string;
  description?: string;
}

export interface ModuleDef {
  module: string;
  label: string;
  actions: ActionDef[];
}

const A = {
  view: { action: 'view', label: 'View' },
  create: { action: 'create', label: 'Create' },
  edit: { action: 'edit', label: 'Edit' },
  delete: { action: 'delete', label: 'Delete' },
  assign: { action: 'assign', label: 'Assign' },
  approve: { action: 'approve', label: 'Approve' },
  export: { action: 'export', label: 'Export' },
  manageTargets: { action: 'manage_targets', label: 'Manage Targets for' },
} as const;

export const PERMISSION_MODULES: ModuleDef[] = [
  { module: 'user', label: 'Users', actions: [A.view, A.create, A.edit, A.delete, A.assign] },
  { module: 'role', label: 'Roles', actions: [A.view, A.create, A.edit, A.delete, A.assign] },
  { module: 'assistant', label: 'Assistants', actions: [A.view, A.create, A.edit, A.delete, A.assign] },
  { module: 'task', label: 'Tasks', actions: [A.view, A.create, A.edit, A.delete, A.assign, A.approve, A.export] },
  { module: 'project', label: 'Projects', actions: [A.view, A.create, A.edit, A.delete, A.assign] },
  { module: 'report', label: 'Reports', actions: [A.view, A.export] },
  { module: 'performance', label: 'Team Performance', actions: [A.view, A.manageTargets] },
  { module: 'audit', label: 'Audit Logs', actions: [A.view, A.export] },
  { module: 'settings', label: 'Settings', actions: [A.view, A.edit] },
];

export interface PermissionDef {
  key: string;
  module: string;
  action: string;
  label: string;
}

/** Flattened list of every `module.action` permission the system knows about. */
export function buildPermissionCatalog(): PermissionDef[] {
  const out: PermissionDef[] = [];
  for (const m of PERMISSION_MODULES) {
    for (const a of m.actions) {
      out.push({
        key: `${m.module}.${a.action}`,
        module: m.module,
        action: a.action,
        label: `${a.label} ${m.label}`,
      });
    }
  }
  return out;
}

export const ALL_PERMISSION_KEYS: string[] = buildPermissionCatalog().map((p) => p.key);

const keys = (module: string, actions: string[]) => actions.map((a) => `${module}.${a}`);

/**
 * Default permission sets for the seeded system roles (slugs match the legacy
 * `Role` enum so existing logins keep resolving). These are only DEFAULTS — once
 * seeded, roles are fully editable in the Role Management UI.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<string, string[] | 'ALL'> = {
  SUPERADMIN: 'ALL',
  ADMIN: [
    ...keys('user', ['view', 'create', 'edit', 'assign']),
    ...keys('role', ['view']),
    ...keys('assistant', ['view', 'create', 'edit', 'delete', 'assign']),
    ...keys('task', ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export']),
    ...keys('project', ['view', 'create', 'edit', 'delete', 'assign']),
    ...keys('report', ['view', 'export']),
    ...keys('performance', ['view', 'manage_targets']),
    ...keys('audit', ['view']),
    ...keys('settings', ['view']),
  ],
  HOD: [
    ...keys('user', ['view']),
    ...keys('assistant', ['view', 'create', 'edit', 'assign']),
    ...keys('task', ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export']),
    ...keys('project', ['view', 'create', 'edit']),
    ...keys('report', ['view']),
    ...keys('performance', ['view', 'manage_targets']),
    ...keys('audit', ['view']),
  ],
  LEAD: [
    ...keys('user', ['view']),
    ...keys('assistant', ['view', 'create', 'edit', 'assign']),
    // LEAD approves their own direct reports' tasks (assignee's managerId == LEAD).
    ...keys('task', ['view', 'create', 'edit', 'delete', 'assign', 'approve', 'export']),
    ...keys('project', ['view', 'edit']),
    ...keys('report', ['view']),
    ...keys('performance', ['view']),
  ],
  ASSOCIATE: [
    // Associates can create/manage their own personal tasks (no assign/approve).
    ...keys('task', ['view', 'create', 'edit', 'delete', 'export']),
    ...keys('project', ['view']),
    ...keys('report', ['view']),
  ],
};

export interface SystemRoleSeed {
  slug: string;
  name: string;
  description: string;
}

export const SYSTEM_ROLES: SystemRoleSeed[] = [
  { slug: 'SUPERADMIN', name: 'Super Admin', description: 'Full platform access' },
  { slug: 'ADMIN', name: 'Admin', description: 'Organization administration' },
  { slug: 'HOD', name: 'Head of Department', description: 'Department-level management' },
  { slug: 'LEAD', name: 'Team Lead', description: 'Team-level management' },
  { slug: 'ASSOCIATE', name: 'Associate', description: 'Individual contributor' },
];

/**
 * Zero-permission base role assigned to delegated assistants. An assistant
 * starts with NO permissions of their own; the principal grants an explicit
 * subset (stored as GRANT overrides) which the resolver then caps to the
 * principal's effective permissions.
 */
export const ASSISTANT_BASE_ROLE: SystemRoleSeed = {
  slug: 'ASSISTANT',
  name: 'Assistant (Delegated)',
  description: 'Delegated assistant — permissions are granted per assistant by the principal',
};
