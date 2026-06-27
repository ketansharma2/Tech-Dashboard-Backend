import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Department, Prisma, Role, TargetScope } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT, ENTITY } from '../../audit/audit-actions';
import {
  PerformanceActionDto,
  PerformanceActionResult,
  PerformanceActionType,
} from '../dto/performance-action.dto';

/** Editable target fields (all optional / nullable Ints on KpiTarget). */
const TARGET_FIELDS = [
  'completionRate',
  'onTimeRate',
  'maxOverdue',
  'cycleTimeDays',
] as const;
type TargetField = (typeof TARGET_FIELDS)[number];

type TargetValues = Partial<Record<TargetField, number | null>>;

const DEPARTMENTS = Object.values(Department) as Department[];

/**
 * Manages configurable KPI targets with a two-level hierarchy:
 *   GLOBAL      — org-wide defaults (ADMIN / SUPERADMIN only)
 *   DEPARTMENT  — per-department override (ADMIN / SUPERADMIN any dept; HOD own dept only)
 *
 * A LEAD inherits targets (read-only) and never manages them. Scope enforcement
 * lives here; the controller only gates the coarse `performance.manage_targets`
 * permission. GLOBAL uniqueness is app-enforced because Postgres treats NULLs as
 * distinct in the @@unique([scope, department]) constraint.
 */
@Injectable()
export class PerformanceTargetService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /* ----------------------------- read ----------------------------- */

  /** Targets relevant to the viewer + what they're allowed to manage. */
  async list(actorId: string, actorRole: Role) {
    const isOrgAdmin = actorRole === 'ADMIN' || actorRole === 'SUPERADMIN';
    const actorDept = isOrgAdmin ? null : await this.getActorDepartment(actorId);

    const departmentWhere: Prisma.KpiTargetWhereInput = isOrgAdmin
      ? { scope: 'DEPARTMENT' }
      : { scope: 'DEPARTMENT', department: actorDept ?? '__none__' as Department };

    const [global, departments] = await Promise.all([
      this.prisma.kpiTarget.findFirst({ where: { scope: 'GLOBAL' } }),
      actorRole === 'LEAD' || actorDept || isOrgAdmin
        ? this.prisma.kpiTarget.findMany({
            where: departmentWhere,
            orderBy: { department: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    return {
      global,
      departments,
      capabilities: {
        canManageGlobal: isOrgAdmin,
        manageableDepartments: isOrgAdmin
          ? DEPARTMENTS
          : actorRole === 'HOD' && actorDept
            ? [actorDept]
            : [],
      },
    };
  }

  /* ----------------------------- write ----------------------------- */

  async execute(
    dto: PerformanceActionDto,
    actorId: string,
    actorRole: Role,
  ): Promise<PerformanceActionResult> {
    switch (dto.action) {
      case PerformanceActionType.SET_TARGET:
        return this.setTarget(actorId, actorRole, dto.payload);
      case PerformanceActionType.RESET_TARGET:
        return this.resetTarget(actorId, actorRole, dto.payload);
      default:
        throw new BadRequestException(`Unknown action: ${String(dto.action)}`);
    }
  }

  private async setTarget(
    actorId: string,
    actorRole: Role,
    payload?: Record<string, any>,
  ): Promise<PerformanceActionResult> {
    const { scope, department } = await this.resolveTargetRef(actorId, actorRole, payload);
    const values = this.parseValues(payload);
    if (Object.keys(values).length === 0) {
      throw new BadRequestException('At least one target value is required');
    }

    const existing = await this.findTarget(scope, department);
    let saved;
    if (existing) {
      saved = await this.prisma.kpiTarget.update({
        where: { id: existing.id },
        data: { ...values, updatedById: actorId },
      });
    } else {
      saved = await this.prisma.kpiTarget.create({
        data: { scope, department, ...values, updatedById: actorId },
      });
    }

    await this.audit.log({
      action: AUDIT.PERF_TARGET_SET,
      actorId,
      entityType: ENTITY.KPI_TARGET,
      entityId: saved.id,
      oldValues: existing ? this.snapshot(existing) : null,
      newValues: this.snapshot(saved),
      metadata: { scope, department },
    });

    return {
      success: true,
      action: PerformanceActionType.SET_TARGET,
      data: saved,
      message: 'Target saved',
    };
  }

  private async resetTarget(
    actorId: string,
    actorRole: Role,
    payload?: Record<string, any>,
  ): Promise<PerformanceActionResult> {
    const { scope, department } = await this.resolveTargetRef(actorId, actorRole, payload);

    const existing = await this.findTarget(scope, department);
    if (existing) {
      await this.prisma.kpiTarget.delete({ where: { id: existing.id } });
      await this.audit.log({
        action: AUDIT.PERF_TARGET_RESET,
        actorId,
        entityType: ENTITY.KPI_TARGET,
        entityId: existing.id,
        oldValues: this.snapshot(existing),
        metadata: { scope, department },
      });
    }

    return {
      success: true,
      action: PerformanceActionType.RESET_TARGET,
      data: { scope, department },
      message: existing
        ? scope === 'GLOBAL'
          ? 'Global target cleared'
          : 'Department override removed (now inherits global)'
        : 'No target to reset',
    };
  }

  /* ----------------------------- helpers ----------------------------- */

  /**
   * Validate the {scope, department} ref against the actor's authority. GLOBAL is
   * ADMIN/SUPERADMIN-only; DEPARTMENT is any dept for org admins, own dept for HOD.
   */
  private async resolveTargetRef(
    actorId: string,
    actorRole: Role,
    payload?: Record<string, any>,
  ): Promise<{ scope: TargetScope; department: Department | null }> {
    const isOrgAdmin = actorRole === 'ADMIN' || actorRole === 'SUPERADMIN';
    const rawScope = payload?.scope;
    if (rawScope !== 'GLOBAL' && rawScope !== 'DEPARTMENT') {
      throw new BadRequestException('scope must be GLOBAL or DEPARTMENT');
    }
    const scope = rawScope as TargetScope;

    if (scope === 'GLOBAL') {
      if (!isOrgAdmin) {
        throw new ForbiddenException('Only administrators can manage the global target');
      }
      return { scope, department: null };
    }

    // DEPARTMENT
    const department = payload?.department as Department | undefined;
    if (!department || !DEPARTMENTS.includes(department)) {
      throw new BadRequestException('A valid department is required for a department target');
    }
    if (!isOrgAdmin) {
      if (actorRole !== 'HOD') {
        throw new ForbiddenException('You cannot manage department targets');
      }
      const actorDept = await this.getActorDepartment(actorId);
      if (!actorDept || actorDept !== department) {
        throw new ForbiddenException('You can only manage targets for your own department');
      }
    }
    return { scope, department };
  }

  /** GLOBAL has a nullable department, so it can't be looked up by compound unique. */
  private findTarget(scope: TargetScope, department: Department | null) {
    return scope === 'GLOBAL'
      ? this.prisma.kpiTarget.findFirst({ where: { scope: 'GLOBAL' } })
      : this.prisma.kpiTarget.findUnique({
          where: { scope_department: { scope, department: department! } },
        });
  }

  /** Coerce + validate the four target metrics. Omitted keys are left untouched. */
  private parseValues(payload?: Record<string, any>): TargetValues {
    const out: TargetValues = {};
    for (const field of TARGET_FIELDS) {
      if (payload == null || !(field in payload)) continue;
      const raw = payload[field];
      if (raw === null || raw === '') {
        out[field] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw new BadRequestException(`${field} must be a non-negative integer`);
      }
      if ((field === 'completionRate' || field === 'onTimeRate') && n > 100) {
        throw new BadRequestException(`${field} must be between 0 and 100`);
      }
      out[field] = n;
    }
    return out;
  }

  private async getActorDepartment(actorId: string): Promise<Department | null> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { department: true },
    });
    return actor?.department ?? null;
  }

  private snapshot(t: {
    completionRate: number | null;
    onTimeRate: number | null;
    maxOverdue: number | null;
    cycleTimeDays: number | null;
  }) {
    return {
      completionRate: t.completionRate,
      onTimeRate: t.onTimeRate,
      maxOverdue: t.maxOverdue,
      cycleTimeDays: t.cycleTimeDays,
    };
  }
}
