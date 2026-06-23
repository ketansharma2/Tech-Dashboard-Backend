import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_MODULES } from '../authz/permission-registry';

export interface PermissionCatalogModule {
  module: string;
  label: string;
  permissions: { key: string; action: string; label: string }[];
}

/**
 * Serves the DYNAMIC permission catalog (sourced from the DB, ordered/labelled
 * via the registry). Drives the permission-matrix UI for roles and assistants.
 * New modules added to the registry + seeded appear here automatically.
 */
@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async getCatalog(): Promise<{ modules: PermissionCatalogModule[] }> {
    const rows = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
      select: { key: true, module: true, action: true, label: true },
    });

    const order = PERMISSION_MODULES.map((m) => m.module);
    const labelOf = new Map(PERMISSION_MODULES.map((m) => [m.module, m.label]));

    const grouped = new Map<string, { key: string; action: string; label: string }[]>();
    for (const r of rows) {
      if (!grouped.has(r.module)) grouped.set(r.module, []);
      grouped.get(r.module)!.push({ key: r.key, action: r.action, label: r.label });
    }

    const modules = [...grouped.keys()]
      .sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
      .map((module) => ({
        module,
        label: labelOf.get(module) ?? module,
        permissions: grouped.get(module)!,
      }));

    return { modules };
  }
}
