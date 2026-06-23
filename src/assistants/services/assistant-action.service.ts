import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT, ENTITY } from '../../audit/audit-actions';
import { PermissionResolverService } from '../../authz/permission-resolver.service';
import { ASSISTANT_BASE_ROLE } from '../../authz/permission-registry';
import {
  AssistantActionDto,
  AssistantActionResult,
  AssistantActionType,
} from '../dto/assistant-action.dto';

const PASSWORD_SALT_ROUNDS = 10;

@Injectable()
export class AssistantActionService {
  private assistantRoleId: string | null = null;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private resolver: PermissionResolverService,
  ) {}

  async execute(
    dto: AssistantActionDto,
    actorId: string,
    actorRole: Role,
  ): Promise<AssistantActionResult> {
    if (dto.action !== AssistantActionType.CREATE && !dto.assistantId) {
      throw new BadRequestException(`assistantId is required for action ${dto.action}`);
    }

    switch (dto.action) {
      case AssistantActionType.CREATE:
        return this.handleCreate(actorId, dto.payload);
      case AssistantActionType.UPDATE:
        return this.handleUpdate(actorId, actorRole, dto.assistantId!, dto.payload);
      case AssistantActionType.ACTIVATE:
        return this.setActive(actorId, actorRole, dto.assistantId!, true);
      case AssistantActionType.DEACTIVATE:
        return this.setActive(actorId, actorRole, dto.assistantId!, false);
      case AssistantActionType.RESET_PASSWORD:
        return this.handleResetPassword(actorId, actorRole, dto.assistantId!, dto.payload);
      case AssistantActionType.GRANT_PERMISSIONS:
        return this.handleGrant(actorId, actorRole, dto.assistantId!, dto.payload);
      case AssistantActionType.REVOKE_PERMISSIONS:
        return this.handleRevoke(actorId, actorRole, dto.assistantId!, dto.payload);
      case AssistantActionType.DELETE:
        return this.handleDelete(actorId, actorRole, dto.assistantId!);
      default:
        throw new BadRequestException(`Unknown action: ${dto.action}`);
    }
  }

  /* ----------------------------- helpers ----------------------------- */

  private async requirePermission(actorId: string, key: string) {
    if (!(await this.resolver.hasAll(actorId, [key]))) {
      throw new ForbiddenException(`Missing required permission: ${key}`);
    }
  }

  /** Self-heal the zero-permission base role so assistants never inherit perms. */
  private async getAssistantRoleId(): Promise<string> {
    if (this.assistantRoleId) return this.assistantRoleId;
    const role = await this.prisma.appRole.upsert({
      where: { slug: ASSISTANT_BASE_ROLE.slug },
      update: {},
      create: {
        slug: ASSISTANT_BASE_ROLE.slug,
        name: ASSISTANT_BASE_ROLE.name,
        description: ASSISTANT_BASE_ROLE.description,
        isSystem: true,
      },
    });
    this.assistantRoleId = role.id;
    return role.id;
  }

  private async getAssistantOwnedOrThrow(assistantId: string, actorId: string, actorRole: Role) {
    const assistant = await this.prisma.user.findFirst({
      where: { id: assistantId, principalId: { not: null } },
    });
    if (!assistant) throw new NotFoundException('Assistant not found');
    if (actorRole !== 'SUPERADMIN' && assistant.principalId !== actorId) {
      throw new ForbiddenException('This assistant does not belong to you');
    }
    return assistant;
  }

  /**
   * THE critical rule: an assistant's permissions must always be a subset of
   * the principal's CURRENT effective permissions. Validated server-side, never
   * trusting the client. Returns the resolved {id, key} rows.
   */
  private async assertWithinPrincipal(principalId: string, keys: string[]) {
    const valid = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const known = new Set(valid.map((p) => p.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) {
      throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')}`);
    }

    const cap = await this.resolver.getEffectivePermissions(principalId);
    const exceeds = keys.filter((k) => !cap.has(k));
    if (exceeds.length) {
      throw new ForbiddenException(
        `Assistant permissions cannot exceed the principal's: ${exceeds.join(', ')}`,
      );
    }
    return valid;
  }

  /* ----------------------------- handlers ----------------------------- */

  private async handleCreate(actorId: string, payload?: Record<string, any>): Promise<AssistantActionResult> {
    await this.requirePermission(actorId, 'assistant.create');
    if (!payload) throw new BadRequestException('payload is required');

    const { firstName, lastName, email, password } = payload;
    if (!firstName || !lastName || !email || !password) {
      throw new BadRequestException('firstName, lastName, email and password are required');
    }

    const keys: string[] = Array.isArray(payload.permissionKeys) ? payload.permissionKeys : [];
    const grantRows = keys.length ? await this.assertWithinPrincipal(actorId, keys) : [];

    const existing = await this.prisma.user.findUnique({
      where: { email: String(email).trim() },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await bcrypt.hash(String(password), PASSWORD_SALT_ROUNDS);
    const assistantRoleId = await this.getAssistantRoleId();

    const assistant = await this.prisma.user.create({
      data: {
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: String(email).trim(),
        passwordHash,
        role: Role.ASSOCIATE, // legacy enum (required); real authority is the empty base role + grants
        roleId: assistantRoleId,
        principalId: actorId,
        jobTitle: payload.jobTitle?.trim() || null,
        isActive: payload.isActive ?? true,
        permissionOverrides: {
          create: grantRows.map((p) => ({ permissionId: p.id, effect: 'GRANT' as const })),
        },
      },
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
    });

    await this.audit.log({
      action: AUDIT.ASSISTANT_CREATE,
      actorId,
      entityType: ENTITY.ASSISTANT,
      entityId: assistant.id,
      targetUserId: assistant.id,
      newValues: { email: assistant.email, permissionKeys: keys },
    });

    return { success: true, action: AssistantActionType.CREATE, data: assistant, message: 'Assistant created' };
  }

  private async handleUpdate(actorId: string, actorRole: Role, assistantId: string, payload?: Record<string, any>): Promise<AssistantActionResult> {
    await this.requirePermission(actorId, 'assistant.edit');
    await this.getAssistantOwnedOrThrow(assistantId, actorId, actorRole);

    const data: Record<string, any> = {};
    if (payload?.firstName !== undefined) data.firstName = String(payload.firstName).trim();
    if (payload?.lastName !== undefined) data.lastName = String(payload.lastName).trim();
    if (payload?.jobTitle !== undefined) data.jobTitle = payload.jobTitle?.trim() || null;
    if (payload?.profileImage !== undefined) data.profileImage = payload.profileImage || null;

    const updated = await this.prisma.user.update({
      where: { id: assistantId },
      data,
      select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
    });

    await this.audit.log({
      action: AUDIT.ASSISTANT_UPDATE,
      actorId,
      entityType: ENTITY.ASSISTANT,
      entityId: assistantId,
      targetUserId: assistantId,
      newValues: data,
    });

    return { success: true, action: AssistantActionType.UPDATE, data: updated, message: 'Assistant updated' };
  }

  private async setActive(actorId: string, actorRole: Role, assistantId: string, isActive: boolean): Promise<AssistantActionResult> {
    await this.requirePermission(actorId, 'assistant.edit');
    await this.getAssistantOwnedOrThrow(assistantId, actorId, actorRole);

    await this.prisma.user.update({ where: { id: assistantId }, data: { isActive } });

    await this.audit.log({
      action: isActive ? AUDIT.ASSISTANT_ACTIVATE : AUDIT.ASSISTANT_DEACTIVATE,
      actorId,
      entityType: ENTITY.ASSISTANT,
      entityId: assistantId,
      targetUserId: assistantId,
    });

    return {
      success: true,
      action: isActive ? AssistantActionType.ACTIVATE : AssistantActionType.DEACTIVATE,
      data: { id: assistantId, isActive },
      message: `Assistant ${isActive ? 'activated' : 'deactivated'}`,
    };
  }

  private async handleResetPassword(actorId: string, actorRole: Role, assistantId: string, payload?: Record<string, any>): Promise<AssistantActionResult> {
    await this.requirePermission(actorId, 'assistant.edit');
    await this.getAssistantOwnedOrThrow(assistantId, actorId, actorRole);

    const newPassword: string = payload?.newPassword || randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);

    await this.prisma.user.update({ where: { id: assistantId }, data: { passwordHash } });
    await this.prisma.refreshToken.deleteMany({ where: { userId: assistantId } });

    await this.audit.log({
      action: AUDIT.ASSISTANT_RESET_PASSWORD,
      actorId,
      entityType: ENTITY.ASSISTANT,
      entityId: assistantId,
      targetUserId: assistantId,
    });

    return {
      success: true,
      action: AssistantActionType.RESET_PASSWORD,
      data: { id: assistantId, tempPassword: payload?.newPassword ? undefined : newPassword },
      message: 'Password reset',
    };
  }

  private async handleGrant(actorId: string, actorRole: Role, assistantId: string, payload?: Record<string, any>): Promise<AssistantActionResult> {
    await this.requirePermission(actorId, 'assistant.assign');
    const assistant = await this.getAssistantOwnedOrThrow(assistantId, actorId, actorRole);

    const keys: string[] = Array.isArray(payload?.permissionKeys) ? payload!.permissionKeys : [];
    if (!keys.length) throw new BadRequestException('permissionKeys is required');

    // Cap against the assistant's OWN principal (not necessarily the actor).
    const grantRows = await this.assertWithinPrincipal(assistant.principalId!, keys);

    await this.prisma.$transaction(
      grantRows.map((p) =>
        this.prisma.userPermissionOverride.upsert({
          where: { userId_permissionId: { userId: assistantId, permissionId: p.id } },
          update: { effect: 'GRANT' },
          create: { userId: assistantId, permissionId: p.id, effect: 'GRANT' },
        }),
      ),
    );

    await this.audit.log({
      action: AUDIT.ASSISTANT_GRANT_PERMISSIONS,
      actorId,
      entityType: ENTITY.ASSISTANT,
      entityId: assistantId,
      targetUserId: assistantId,
      newValues: { permissionKeys: keys },
    });

    return {
      success: true,
      action: AssistantActionType.GRANT_PERMISSIONS,
      data: { id: assistantId, granted: keys },
      message: 'Permissions granted',
    };
  }

  private async handleRevoke(actorId: string, actorRole: Role, assistantId: string, payload?: Record<string, any>): Promise<AssistantActionResult> {
    await this.requirePermission(actorId, 'assistant.assign');
    await this.getAssistantOwnedOrThrow(assistantId, actorId, actorRole);

    const keys: string[] = Array.isArray(payload?.permissionKeys) ? payload!.permissionKeys : [];
    if (!keys.length) throw new BadRequestException('permissionKeys is required');

    const perms = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });

    await this.prisma.userPermissionOverride.deleteMany({
      where: { userId: assistantId, permissionId: { in: perms.map((p) => p.id) } },
    });

    await this.audit.log({
      action: AUDIT.ASSISTANT_REVOKE_PERMISSIONS,
      actorId,
      entityType: ENTITY.ASSISTANT,
      entityId: assistantId,
      targetUserId: assistantId,
      oldValues: { permissionKeys: keys },
    });

    return {
      success: true,
      action: AssistantActionType.REVOKE_PERMISSIONS,
      data: { id: assistantId, revoked: keys },
      message: 'Permissions revoked',
    };
  }

  private async handleDelete(actorId: string, actorRole: Role, assistantId: string): Promise<AssistantActionResult> {
    await this.requirePermission(actorId, 'assistant.delete');
    const assistant = await this.getAssistantOwnedOrThrow(assistantId, actorId, actorRole);

    await this.prisma.user.delete({ where: { id: assistantId } });

    await this.audit.log({
      action: AUDIT.ASSISTANT_DELETE,
      actorId,
      entityType: ENTITY.ASSISTANT,
      entityId: assistantId,
      oldValues: { email: assistant.email },
    });

    return { success: true, action: AssistantActionType.DELETE, data: { id: assistantId }, message: 'Assistant deleted' };
  }
}
