import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuditAction, Department, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  UserActionContext,
  UserActionDto,
  UserActionResult,
  UserActionType,
} from '../dto/user-action.dto';
import {
  UserPermission,
  assertCanManageRole,
  assertPermission,
  permissionForAction,
} from '../../auth/permissions/user-permission.policy';
import { USER_SELECT, SanitizedUser } from '../user.select';

type ActionHandler = (ctx: UserActionContext) => Promise<UserActionResult>;

const PASSWORD_SALT_ROUNDS = 10;

@Injectable()
export class UserActionService {
  private readonly registry: Map<UserActionType, ActionHandler>;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {
    this.registry = new Map<UserActionType, ActionHandler>([
      [UserActionType.CREATE_USER, this.handleCreate.bind(this)],
      [UserActionType.UPDATE_USER, this.handleUpdate.bind(this)],
      [UserActionType.DELETE_USER, this.handleDelete.bind(this)],
      [UserActionType.ACTIVATE_USER, this.handleActivate.bind(this)],
      [UserActionType.DEACTIVATE_USER, this.handleDeactivate.bind(this)],
      [UserActionType.RESET_PASSWORD, this.handleResetPassword.bind(this)],
      [UserActionType.ASSIGN_ROLE, this.handleAssignRole.bind(this)],
      [UserActionType.ASSIGN_DEPARTMENT, this.handleAssignDepartment.bind(this)],
      [UserActionType.ASSIGN_MANAGER, this.handleAssignManager.bind(this)],
    ]);
  }

  /**
   * Single entry point for all mutations. Enforces the central permission gate
   * BEFORE dispatching, then delegates to the registered handler. Target-level
   * rules (e.g. nobody-but-SUPERADMIN may touch a SUPERADMIN) live in the
   * handlers via the same policy.
   */
  async execute(
    dto: UserActionDto,
    actorId: string,
    actorRole: Role,
  ): Promise<UserActionResult> {
    // 1. Centralized role → action permission check.
    assertPermission(actorRole, permissionForAction(dto.action));

    // 2. All actions except CREATE operate on an existing target user.
    if (dto.action !== UserActionType.CREATE_USER && !dto.userId) {
      throw new BadRequestException(`userId is required for action ${dto.action}`);
    }

    const handler = this.registry.get(dto.action);
    if (!handler) {
      throw new BadRequestException(`Unknown action: ${dto.action}`);
    }

    return handler({
      actorId,
      actorRole,
      action: dto.action,
      userId: dto.userId,
      payload: dto.payload,
    });
  }

  /* ----------------------------- helpers ----------------------------- */

  private async getTargetOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    return user;
  }

  private sanitized(userId: string): Promise<SanitizedUser> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: USER_SELECT,
    });
  }

  private parseDepartment(value: unknown): Department | null {
    if (value === null || value === undefined || value === '') return null;
    if (!Object.values(Department).includes(value as Department)) {
      throw new BadRequestException(`Invalid department: ${value}`);
    }
    return value as Department;
  }

  private parseRole(value: unknown): Role {
    if (!Object.values(Role).includes(value as Role)) {
      throw new BadRequestException(`Invalid role: ${value}`);
    }
    return value as Role;
  }

  private async assertManagerExists(managerId: string, targetUserId?: string) {
    if (targetUserId && managerId === targetUserId) {
      throw new BadRequestException('A user cannot be their own manager');
    }
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true },
    });
    if (!manager) {
      throw new BadRequestException(`Manager with ID ${managerId} not found`);
    }
  }

  /* ----------------------------- handlers ----------------------------- */

  private async handleCreate(ctx: UserActionContext): Promise<UserActionResult> {
    const { actorId, actorRole, payload } = ctx;
    if (!payload) throw new BadRequestException('payload is required for CREATE_USER');

    const { firstName, lastName, email, password } = payload;
    if (!firstName || !lastName || !email || !password) {
      throw new BadRequestException(
        'firstName, lastName, email and password are required',
      );
    }

    const targetRole = payload.role ? this.parseRole(payload.role) : Role.ASSOCIATE;
    // ADMIN cannot create a SUPERADMIN (and cannot assign roles above itself).
    assertCanManageRole(actorRole, targetRole);

    const department = this.parseDepartment(payload.department);
    if (payload.managerId) await this.assertManagerExists(payload.managerId);

    const existing = await this.prisma.user.findUnique({
      where: { email: String(email).trim() },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email already exists');

    const passwordHash = await bcrypt.hash(String(password), PASSWORD_SALT_ROUNDS);

    const created = await this.prisma.user.create({
      data: {
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: String(email).trim(),
        passwordHash,
        role: targetRole,
        department,
        jobTitle: payload.jobTitle?.trim() || null,
        phone: payload.phone?.trim() || null,
        location: payload.location?.trim() || null,
        profileImage: payload.profileImage || null,
        isActive: payload.isActive ?? true,
        managerId: payload.managerId || null,
      },
      select: USER_SELECT,
    });

    await this.audit.log({
      action: AuditAction.CREATE_USER,
      actorId,
      targetUserId: created.id,
      metadata: { role: targetRole, department, email: created.email },
    });

    return {
      success: true,
      action: UserActionType.CREATE_USER,
      data: created,
      message: 'User created successfully',
    };
  }

  private async handleUpdate(ctx: UserActionContext): Promise<UserActionResult> {
    const { actorId, actorRole, userId, payload } = ctx;
    const target = await this.getTargetOrThrow(userId!);

    // Cannot edit someone above your management level (e.g. ADMIN → SUPERADMIN).
    assertCanManageRole(actorRole, target.role);

    const data: Prisma.UserUpdateInput = {};
    const auditEntries: { action: AuditAction; metadata?: Record<string, any> }[] = [];

    // Plain profile fields.
    if (payload?.firstName !== undefined) data.firstName = String(payload.firstName).trim();
    if (payload?.lastName !== undefined) data.lastName = String(payload.lastName).trim();
    if (payload?.jobTitle !== undefined) data.jobTitle = payload.jobTitle?.trim() || null;
    if (payload?.phone !== undefined) data.phone = payload.phone?.trim() || null;
    if (payload?.location !== undefined) data.location = payload.location?.trim() || null;
    if (payload?.profileImage !== undefined) data.profileImage = payload.profileImage || null;

    // Email change (must stay unique).
    if (payload?.email !== undefined && payload.email !== target.email) {
      const clash = await this.prisma.user.findUnique({
        where: { email: String(payload.email).trim() },
        select: { id: true },
      });
      if (clash && clash.id !== target.id) {
        throw new ConflictException('Email already exists');
      }
      data.email = String(payload.email).trim();
    }

    // Role change — requires the ASSIGN_ROLE permission (SUPERADMIN only).
    if (payload?.role !== undefined) {
      const nextRole = this.parseRole(payload.role);
      if (nextRole !== target.role) {
        assertPermission(actorRole, UserPermission.ASSIGN_ROLE);
        assertCanManageRole(actorRole, nextRole);
        data.role = nextRole;
        auditEntries.push({
          action: AuditAction.ROLE_CHANGE,
          metadata: { from: target.role, to: nextRole },
        });
      }
    }

    // Department change — requires ASSIGN_DEPARTMENT.
    if (payload?.department !== undefined) {
      const nextDept = this.parseDepartment(payload.department);
      if (nextDept !== target.department) {
        assertPermission(actorRole, UserPermission.ASSIGN_DEPARTMENT);
        data.department = nextDept;
        auditEntries.push({
          action: AuditAction.DEPARTMENT_CHANGE,
          metadata: { from: target.department, to: nextDept },
        });
      }
    }

    // Manager change — requires ASSIGN_MANAGER.
    if (payload?.managerId !== undefined) {
      const nextManager: string | null = payload.managerId || null;
      if (nextManager !== target.managerId) {
        assertPermission(actorRole, UserPermission.ASSIGN_MANAGER);
        if (nextManager) await this.assertManagerExists(nextManager, target.id);
        data.manager = nextManager
          ? { connect: { id: nextManager } }
          : { disconnect: true };
        auditEntries.push({
          action: AuditAction.MANAGER_CHANGE,
          metadata: { from: target.managerId, to: nextManager },
        });
      }
    }

    await this.prisma.user.update({ where: { id: target.id }, data });
    const updated = await this.sanitized(target.id);

    await this.audit.log({
      action: AuditAction.UPDATE_USER,
      actorId,
      targetUserId: target.id,
      metadata: { fields: Object.keys(data) },
    });
    await this.audit.logMany(
      auditEntries.map((e) => ({
        action: e.action,
        actorId,
        targetUserId: target.id,
        metadata: e.metadata,
      })),
    );

    return {
      success: true,
      action: UserActionType.UPDATE_USER,
      data: updated,
      message: 'User updated successfully',
    };
  }

  private async handleDelete(ctx: UserActionContext): Promise<UserActionResult> {
    const { actorId, actorRole, userId } = ctx;
    if (userId === actorId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const target = await this.getTargetOrThrow(userId!);
    assertCanManageRole(actorRole, target.role);

    await this.prisma.user.delete({ where: { id: target.id } });

    await this.audit.log({
      action: AuditAction.DELETE_USER,
      actorId,
      targetUserId: null, // target row is gone; keep the id in metadata
      metadata: { deletedUserId: target.id, email: target.email, role: target.role },
    });

    return {
      success: true,
      action: UserActionType.DELETE_USER,
      data: { id: target.id },
      message: 'User deleted successfully',
    };
  }

  private async handleActivate(ctx: UserActionContext): Promise<UserActionResult> {
    return this.setActive(ctx, true);
  }

  private async handleDeactivate(ctx: UserActionContext): Promise<UserActionResult> {
    if (ctx.userId === ctx.actorId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    return this.setActive(ctx, false);
  }

  private async setActive(
    ctx: UserActionContext,
    isActive: boolean,
  ): Promise<UserActionResult> {
    const { actorId, actorRole, userId } = ctx;
    const target = await this.getTargetOrThrow(userId!);
    assertCanManageRole(actorRole, target.role);

    await this.prisma.user.update({ where: { id: target.id }, data: { isActive } });
    const updated = await this.sanitized(target.id);

    await this.audit.log({
      action: isActive ? AuditAction.ACTIVATE_USER : AuditAction.DEACTIVATE_USER,
      actorId,
      targetUserId: target.id,
    });

    return {
      success: true,
      action: isActive ? UserActionType.ACTIVATE_USER : UserActionType.DEACTIVATE_USER,
      data: updated,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
    };
  }

  private async handleResetPassword(ctx: UserActionContext): Promise<UserActionResult> {
    const { actorId, actorRole, userId, payload } = ctx;
    const target = await this.getTargetOrThrow(userId!);
    assertCanManageRole(actorRole, target.role);

    // Use a supplied password or generate a secure temporary one.
    const newPassword: string =
      payload?.newPassword || randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: target.id },
      data: { passwordHash },
    });
    // Invalidate existing sessions for the user.
    await this.prisma.refreshToken.deleteMany({ where: { userId: target.id } });

    await this.audit.log({
      action: AuditAction.RESET_PASSWORD,
      actorId,
      targetUserId: target.id,
    });

    return {
      success: true,
      action: UserActionType.RESET_PASSWORD,
      // In production this would be emailed as a reset link rather than returned.
      data: { id: target.id, tempPassword: payload?.newPassword ? undefined : newPassword },
      message: 'Password reset successfully',
    };
  }

  private async handleAssignRole(ctx: UserActionContext): Promise<UserActionResult> {
    const { actorId, actorRole, userId, payload } = ctx;
    if (!payload?.role) throw new BadRequestException('role is required for ASSIGN_ROLE');

    const target = await this.getTargetOrThrow(userId!);
    assertCanManageRole(actorRole, target.role); // can act on the current target
    const nextRole = this.parseRole(payload.role);
    assertCanManageRole(actorRole, nextRole); // can grant the new role

    await this.prisma.user.update({
      where: { id: target.id },
      data: { role: nextRole },
    });
    const updated = await this.sanitized(target.id);

    await this.audit.log({
      action: AuditAction.ROLE_CHANGE,
      actorId,
      targetUserId: target.id,
      metadata: { from: target.role, to: nextRole },
    });

    return {
      success: true,
      action: UserActionType.ASSIGN_ROLE,
      data: updated,
      message: 'Role assigned successfully',
    };
  }

  private async handleAssignDepartment(ctx: UserActionContext): Promise<UserActionResult> {
    const { actorId, actorRole, userId, payload } = ctx;
    const target = await this.getTargetOrThrow(userId!);
    assertCanManageRole(actorRole, target.role);

    const department = this.parseDepartment(payload?.department);

    await this.prisma.user.update({
      where: { id: target.id },
      data: { department },
    });
    const updated = await this.sanitized(target.id);

    await this.audit.log({
      action: AuditAction.DEPARTMENT_CHANGE,
      actorId,
      targetUserId: target.id,
      metadata: { from: target.department, to: department },
    });

    return {
      success: true,
      action: UserActionType.ASSIGN_DEPARTMENT,
      data: updated,
      message: 'Department assigned successfully',
    };
  }

  private async handleAssignManager(ctx: UserActionContext): Promise<UserActionResult> {
    const { actorId, actorRole, userId, payload } = ctx;
    const target = await this.getTargetOrThrow(userId!);
    assertCanManageRole(actorRole, target.role);

    const nextManager: string | null = payload?.managerId || null;
    if (nextManager) await this.assertManagerExists(nextManager, target.id);

    await this.prisma.user.update({
      where: { id: target.id },
      data: nextManager
        ? { manager: { connect: { id: nextManager } } }
        : { manager: { disconnect: true } },
    });
    const updated = await this.sanitized(target.id);

    await this.audit.log({
      action: AuditAction.MANAGER_CHANGE,
      actorId,
      targetUserId: target.id,
      metadata: { from: target.managerId, to: nextManager },
    });

    return {
      success: true,
      action: UserActionType.ASSIGN_MANAGER,
      data: updated,
      message: 'Manager assigned successfully',
    };
  }
}
