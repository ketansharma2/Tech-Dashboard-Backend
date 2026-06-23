import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The single source of truth for "what can this user do".
 *
 *   Effective Permissions =
 *     Role Permissions
 *     + Granted user overrides
 *     − Revoked user overrides
 *     ∩ Principal's effective permissions   (only when the user is an assistant)
 *
 * Because assistants are intersected with their principal's CURRENT effective
 * permissions, an assistant can never exceed the principal, and if the principal
 * loses a permission the assistant loses it automatically — no extra bookkeeping.
 */
@Injectable()
export class PermissionResolverService {
  constructor(private prisma: PrismaService) {}

  async getEffectivePermissions(
    userId: string,
    seen: Set<string> = new Set(),
  ): Promise<Set<string>> {
    // Defensive: break any accidental delegation cycle.
    if (seen.has(userId)) return new Set();
    seen.add(userId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isActive: true,
        role: true,
        roleId: true,
        principalId: true,
        roleRef: {
          select: {
            isActive: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
        permissionOverrides: {
          select: { effect: true, permission: { select: { key: true } } },
        },
      },
    });

    if (!user || !user.isActive) return new Set();

    // 1. Base = dynamic role permissions. Fall back to the system role whose slug
    //    matches the legacy enum when a user has no explicit roleId yet.
    let effective = new Set<string>();
    if (user.roleRef) {
      if (user.roleRef.isActive) {
        effective = new Set(user.roleRef.permissions.map((rp) => rp.permission.key));
      }
    } else {
      const fallback = await this.prisma.appRole.findUnique({
        where: { slug: user.role },
        select: {
          isActive: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      });
      if (fallback?.isActive) {
        effective = new Set(fallback.permissions.map((rp) => rp.permission.key));
      }
    }

    // 2. Apply user-level overrides.
    for (const o of user.permissionOverrides) {
      if (o.effect === 'GRANT') effective.add(o.permission.key);
      else effective.delete(o.permission.key);
    }

    // 3. Assistant cap: intersect with the principal's effective permissions.
    if (user.principalId) {
      const cap = await this.getEffectivePermissions(user.principalId, seen);
      effective = new Set([...effective].filter((k) => cap.has(k)));
    }

    return effective;
  }

  async getEffectivePermissionList(userId: string): Promise<string[]> {
    return [...(await this.getEffectivePermissions(userId))].sort();
  }

  async hasAll(userId: string, required: string[]): Promise<boolean> {
    if (required.length === 0) return true;
    const eff = await this.getEffectivePermissions(userId);
    return required.every((k) => eff.has(k));
  }

  async hasAny(userId: string, required: string[]): Promise<boolean> {
    if (required.length === 0) return true;
    const eff = await this.getEffectivePermissions(userId);
    return required.some((k) => eff.has(k));
  }
}
