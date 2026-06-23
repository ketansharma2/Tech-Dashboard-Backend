import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT, ENTITY } from '../../audit/audit-actions';
import { PermissionResolverService } from '../../authz/permission-resolver.service';
import { RoleActionDto, RoleActionResult, RoleActionType } from '../dto/role-action.dto';

@Injectable()
export class RoleActionService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private resolver: PermissionResolverService,
  ) {}

  async execute(dto: RoleActionDto, actorId: string): Promise<RoleActionResult> {
    if (dto.action !== RoleActionType.CREATE && !dto.roleId) {
      throw new BadRequestException(`roleId is required for action ${dto.action}`);
    }

    switch (dto.action) {
      case RoleActionType.CREATE:
        return this.handleCreate(actorId, dto.payload);
      case RoleActionType.UPDATE:
        return this.handleUpdate(actorId, dto.roleId!, dto.payload);
      case RoleActionType.DELETE:
        return this.handleDelete(actorId, dto.roleId!);
      case RoleActionType.CLONE:
        return this.handleClone(actorId, dto.roleId!, dto.payload);
      case RoleActionType.ACTIVATE:
        return this.setActive(actorId, dto.roleId!, true);
      case RoleActionType.DEACTIVATE:
        return this.setActive(actorId, dto.roleId!, false);
      case RoleActionType.ASSIGN_PERMISSIONS:
        return this.handleAssignPermissions(actorId, dto.roleId!, dto.payload);
      default:
        throw new BadRequestException(`Unknown action: ${dto.action}`);
    }
  }

  /* ----------------------------- helpers ----------------------------- */

  /** Prevent privilege escalation: you can only assign permissions you hold. */
  private async assertAssignable(actorId: string, keys: string[]): Promise<string[]> {
    const valid = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const known = new Set(valid.map((p) => p.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) {
      throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')}`);
    }

    const effective = await this.resolver.getEffectivePermissions(actorId);
    const denied = keys.filter((k) => !effective.has(k));
    if (denied.length) {
      throw new ForbiddenException(
        `You cannot assign permissions you do not hold: ${denied.join(', ')}`,
      );
    }
    return valid.map((p) => p.id);
  }

  private async requirePermission(actorId: string, key: string) {
    if (!(await this.resolver.hasAll(actorId, [key]))) {
      throw new ForbiddenException(`Missing required permission: ${key}`);
    }
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = this.slugify(name) || 'role';
    let slug = base;
    let n = 1;
    while (await this.prisma.appRole.findUnique({ where: { slug }, select: { id: true } })) {
      n += 1;
      slug = `${base}-${n}`;
    }
    return slug;
  }

  private async getRoleOrThrow(roleId: string) {
    const role = await this.prisma.appRole.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  /* ----------------------------- handlers ----------------------------- */

  private async handleCreate(actorId: string, payload?: Record<string, any>): Promise<RoleActionResult> {
    await this.requirePermission(actorId, 'role.create');
    const name = payload?.name?.trim();
    if (!name) throw new BadRequestException('name is required');

    const keys: string[] = Array.isArray(payload?.permissionKeys) ? payload!.permissionKeys : [];
    const permissionIds = keys.length ? await this.assertAssignable(actorId, keys) : [];

    const role = await this.prisma.appRole.create({
      data: {
        name,
        slug: await this.uniqueSlug(name),
        description: payload?.description?.trim() || null,
        isActive: payload?.isActive ?? true,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
    });

    await this.audit.log({
      action: AUDIT.ROLE_CREATE,
      actorId,
      entityType: ENTITY.ROLE,
      entityId: role.id,
      newValues: { name, description: role.description, permissionKeys: keys },
    });

    return { success: true, action: RoleActionType.CREATE, data: role, message: 'Role created' };
  }

  private async handleUpdate(actorId: string, roleId: string, payload?: Record<string, any>): Promise<RoleActionResult> {
    await this.requirePermission(actorId, 'role.edit');
    const role = await this.getRoleOrThrow(roleId);

    const data: { name?: string; description?: string | null } = {};
    if (payload?.name !== undefined) data.name = String(payload.name).trim();
    if (payload?.description !== undefined) data.description = payload.description?.trim() || null;

    const updated = await this.prisma.appRole.update({ where: { id: roleId }, data });

    await this.audit.log({
      action: AUDIT.ROLE_UPDATE,
      actorId,
      entityType: ENTITY.ROLE,
      entityId: roleId,
      oldValues: { name: role.name, description: role.description },
      newValues: data,
    });

    return { success: true, action: RoleActionType.UPDATE, data: updated, message: 'Role updated' };
  }

  private async handleDelete(actorId: string, roleId: string): Promise<RoleActionResult> {
    await this.requirePermission(actorId, 'role.delete');
    const role = await this.getRoleOrThrow(roleId);
    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be deleted');
    }
    const userCount = await this.prisma.user.count({ where: { roleId } });
    if (userCount > 0) {
      throw new BadRequestException(
        `Cannot delete: ${userCount} user(s) are assigned this role. Reassign them first.`,
      );
    }

    await this.prisma.appRole.delete({ where: { id: roleId } });

    await this.audit.log({
      action: AUDIT.ROLE_DELETE,
      actorId,
      entityType: ENTITY.ROLE,
      entityId: roleId,
      oldValues: { name: role.name, slug: role.slug },
    });

    return { success: true, action: RoleActionType.DELETE, data: { id: roleId }, message: 'Role deleted' };
  }

  private async handleClone(actorId: string, roleId: string, payload?: Record<string, any>): Promise<RoleActionResult> {
    await this.requirePermission(actorId, 'role.create');
    const source = await this.prisma.appRole.findUnique({
      where: { id: roleId },
      include: { permissions: { select: { permissionId: true } } },
    });
    if (!source) throw new NotFoundException('Role not found');

    const name = payload?.name?.trim() || `${source.name} (Copy)`;
    const role = await this.prisma.appRole.create({
      data: {
        name,
        slug: await this.uniqueSlug(name),
        description: source.description,
        permissions: { create: source.permissions.map((p) => ({ permissionId: p.permissionId })) },
      },
    });

    await this.audit.log({
      action: AUDIT.ROLE_CLONE,
      actorId,
      entityType: ENTITY.ROLE,
      entityId: role.id,
      metadata: { clonedFrom: roleId },
    });

    return { success: true, action: RoleActionType.CLONE, data: role, message: 'Role cloned' };
  }

  private async setActive(actorId: string, roleId: string, isActive: boolean): Promise<RoleActionResult> {
    await this.requirePermission(actorId, 'role.edit');
    const role = await this.getRoleOrThrow(roleId);
    if (role.isSystem && !isActive) {
      throw new ForbiddenException('System roles cannot be deactivated');
    }
    const updated = await this.prisma.appRole.update({ where: { id: roleId }, data: { isActive } });

    await this.audit.log({
      action: isActive ? AUDIT.ROLE_ACTIVATE : AUDIT.ROLE_DEACTIVATE,
      actorId,
      entityType: ENTITY.ROLE,
      entityId: roleId,
    });

    return {
      success: true,
      action: isActive ? RoleActionType.ACTIVATE : RoleActionType.DEACTIVATE,
      data: updated,
      message: `Role ${isActive ? 'activated' : 'deactivated'}`,
    };
  }

  private async handleAssignPermissions(actorId: string, roleId: string, payload?: Record<string, any>): Promise<RoleActionResult> {
    await this.requirePermission(actorId, 'role.edit');
    await this.getRoleOrThrow(roleId);

    const keys: string[] = Array.isArray(payload?.permissionKeys) ? payload!.permissionKeys : [];
    const permissionIds = keys.length ? await this.assertAssignable(actorId, keys) : [];

    const previous = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { key: true } } },
    });

    // Replace the role's permission set atomically.
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        skipDuplicates: true,
      }),
    ]);

    const role = await this.prisma.appRole.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
    });

    await this.audit.log({
      action: AUDIT.ROLE_ASSIGN_PERMISSIONS,
      actorId,
      entityType: ENTITY.ROLE,
      entityId: roleId,
      oldValues: { permissionKeys: previous.map((p) => p.permission.key) },
      newValues: { permissionKeys: keys },
    });

    return {
      success: true,
      action: RoleActionType.ASSIGN_PERMISSIONS,
      data: {
        id: roleId,
        permissionKeys: role?.permissions.map((rp) => rp.permission.key) ?? [],
      },
      message: 'Permissions updated',
    };
  }
}
