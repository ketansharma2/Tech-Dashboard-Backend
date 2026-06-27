import { BadRequestException, Injectable } from '@nestjs/common';
import { Department, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PerformanceQueryDto, PerfRange } from '../dto/performance-query.dto';
import {
  PerformanceScopeService,
  PerformanceScope,
  ScopedMember,
} from './performance-scope.service';

const DAY_MS = 86_400_000;

interface WindowMetrics {
  total: number;
  completed: number;
  completionRate: number;
  onTime: number;
  withDue: number;
  onTimeRate: number;
  cycleAvgDays: number;
}

export interface ResolvedTargets {
  completionRate: number | null;
  onTimeRate: number | null;
  maxOverdue: number | null;
  cycleTimeDays: number | null;
}

type KpiStatus = 'green' | 'amber' | 'red' | null;

const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

@Injectable()
export class PerformanceQueryService {
  constructor(
    private prisma: PrismaService,
    private scopeService: PerformanceScopeService,
  ) {}

  async query(dto: PerformanceQueryDto, actorId: string, actorRole: Role) {
    const scope = await this.scopeService.resolve(actorId, actorRole, dto.department);
    const range = this.resolveRange(dto);

    if (dto.view === 'member') {
      if (!dto.memberId) throw new BadRequestException('memberId is required for view=member');
      return this.memberDetail(dto.memberId, scope, range);
    }
    return this.teamDashboard(scope, range, dto);
  }

  /* ----------------------------- team ----------------------------- */

  private async teamDashboard(
    scope: PerformanceScope,
    range: ResolvedRange,
    dto: PerformanceQueryDto,
  ) {
    const { taskWhere, department, members } = scope;

    const [current, previous, snapshot, targets, trend, distributions, memberRows] =
      await Promise.all([
        this.windowMetrics(taskWhere, range.from, range.to),
        this.windowMetrics(taskWhere, range.prevFrom, range.prevTo),
        this.snapshot(taskWhere),
        this.resolveTargets(department),
        this.trend(taskWhere, range),
        this.distributions(taskWhere, range),
        this.perMember(members, range, dto),
      ]);

    return {
      scope: {
        role: 'team',
        department,
        memberCount: members.length,
        range: { from: range.from, to: range.to, preset: range.preset },
      },
      kpis: this.buildKpis(current, previous, snapshot, targets),
      trend,
      distributions,
      workload: memberRows
        .map((m) => ({ id: m.id, name: m.name, activeTasks: m.activeTasks }))
        .sort((a, b) => b.activeTasks - a.activeTasks),
      members: memberRows,
      targets,
    };
  }

  /* ----------------------------- member ----------------------------- */

  private async memberDetail(
    memberId: string,
    scope: PerformanceScope,
    range: ResolvedRange,
  ) {
    const member = this.scopeService.assertMemberInScope(memberId, scope);
    const taskWhere: Prisma.TaskWhereInput = { assigneeId: memberId };

    const [current, previous, snapshot, targets, trend, distributions, recentTasks] =
      await Promise.all([
        this.windowMetrics(taskWhere, range.from, range.to),
        this.windowMetrics(taskWhere, range.prevFrom, range.prevTo),
        this.snapshot(taskWhere),
        this.resolveTargets(member.department),
        this.trend(taskWhere, range),
        this.distributions(taskWhere, range),
        this.prisma.task.findMany({
          where: { assigneeId: memberId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            completedAt: true,
            isCompleted: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      member,
      scope: { range: { from: range.from, to: range.to, preset: range.preset } },
      kpis: this.buildKpis(current, previous, snapshot, targets),
      trend,
      distributions,
      recentTasks,
      targets,
    };
  }

  /* ----------------------------- metrics ----------------------------- */

  /** Cohort metrics for tasks CREATED in [from,to] (coherent denominator). */
  private async windowMetrics(
    taskWhere: Prisma.TaskWhereInput,
    from: Date,
    to: Date,
  ): Promise<WindowMetrics> {
    const [total, completedRows] = await Promise.all([
      this.prisma.task.count({ where: { ...taskWhere, createdAt: { gte: from, lte: to } } }),
      this.prisma.task.findMany({
        where: {
          ...taskWhere,
          createdAt: { gte: from, lte: to },
          isCompleted: true,
          completedAt: { not: null },
        },
        select: { createdAt: true, completedAt: true, dueDate: true },
      }),
    ]);

    let onTime = 0;
    let withDue = 0;
    let cycleMs = 0;
    for (const r of completedRows) {
      cycleMs += r.completedAt!.getTime() - r.createdAt.getTime();
      if (r.dueDate) {
        withDue += 1;
        if (r.completedAt! <= r.dueDate) onTime += 1;
      }
    }
    const completed = completedRows.length;

    return {
      total,
      completed,
      completionRate: total ? round((completed / total) * 100) : 0,
      onTime,
      withDue,
      onTimeRate: withDue ? round((onTime / withDue) * 100) : 0,
      cycleAvgDays: completed ? round(cycleMs / completed / DAY_MS, 1) : 0,
    };
  }

  /** Point-in-time health: open + overdue counts (not window-bound). */
  private async snapshot(taskWhere: Prisma.TaskWhereInput) {
    const now = new Date();
    const [active, overdue] = await Promise.all([
      this.prisma.task.count({ where: { ...taskWhere, isCompleted: false } }),
      this.prisma.task.count({
        where: { ...taskWhere, isCompleted: false, dueDate: { lt: now } },
      }),
    ]);
    return { active, overdue };
  }

  private async resolveTargets(department: Department | null): Promise<ResolvedTargets> {
    const [global, dept] = await Promise.all([
      this.prisma.kpiTarget.findFirst({ where: { scope: 'GLOBAL' } }),
      department
        ? this.prisma.kpiTarget.findFirst({ where: { scope: 'DEPARTMENT', department } })
        : Promise.resolve(null),
    ]);
    const pick = (f: keyof ResolvedTargets) =>
      (dept?.[f] ?? global?.[f] ?? null) as number | null;
    return {
      completionRate: pick('completionRate'),
      onTimeRate: pick('onTimeRate'),
      maxOverdue: pick('maxOverdue'),
      cycleTimeDays: pick('cycleTimeDays'),
    };
  }

  private statusFor(
    value: number,
    target: number | null,
    higherIsBetter: boolean,
  ): KpiStatus {
    if (target === null || target === undefined) return null;
    if (higherIsBetter) {
      if (value >= target) return 'green';
      if (value >= target * 0.8) return 'amber';
      return 'red';
    }
    if (value <= target) return 'green';
    if (value <= target * 1.25) return 'amber';
    return 'red';
  }

  private buildKpis(
    cur: WindowMetrics,
    prev: WindowMetrics,
    snap: { active: number; overdue: number },
    t: ResolvedTargets,
  ) {
    const delta = (a: number, b: number) => round(a - b, 1);
    return [
      {
        key: 'completionRate',
        label: 'Completion Rate',
        value: cur.completionRate,
        previousValue: prev.completionRate,
        delta: delta(cur.completionRate, prev.completionRate),
        unit: '%',
        higherIsBetter: true,
        target: t.completionRate,
        status: this.statusFor(cur.completionRate, t.completionRate, true),
      },
      {
        key: 'onTimeRate',
        label: 'On-time Rate',
        value: cur.onTimeRate,
        previousValue: prev.onTimeRate,
        delta: delta(cur.onTimeRate, prev.onTimeRate),
        unit: '%',
        higherIsBetter: true,
        target: t.onTimeRate,
        status: this.statusFor(cur.onTimeRate, t.onTimeRate, true),
      },
      {
        key: 'avgCycleTimeDays',
        label: 'Avg Cycle Time',
        value: cur.cycleAvgDays,
        previousValue: prev.cycleAvgDays,
        delta: delta(cur.cycleAvgDays, prev.cycleAvgDays),
        unit: 'days',
        higherIsBetter: false,
        target: t.cycleTimeDays,
        status: this.statusFor(cur.cycleAvgDays, t.cycleTimeDays, false),
      },
      {
        key: 'completedTasks',
        label: 'Completed',
        value: cur.completed,
        previousValue: prev.completed,
        delta: delta(cur.completed, prev.completed),
        unit: 'count',
        higherIsBetter: true,
        target: null,
        status: null,
      },
      {
        key: 'overdueTasks',
        label: 'Overdue',
        value: snap.overdue,
        previousValue: null,
        delta: null,
        unit: 'count',
        higherIsBetter: false,
        target: t.maxOverdue,
        status: this.statusFor(snap.overdue, t.maxOverdue, false),
      },
      {
        key: 'activeTasks',
        label: 'Active Workload',
        value: snap.active,
        previousValue: null,
        delta: null,
        unit: 'count',
        higherIsBetter: false,
        target: null,
        status: null,
      },
    ];
  }

  /* ----------------------------- trend ----------------------------- */

  private async trend(taskWhere: Prisma.TaskWhereInput, range: ResolvedRange) {
    const [createdRows, completedRows] = await Promise.all([
      this.prisma.task.findMany({
        where: { ...taskWhere, createdAt: { gte: range.from, lte: range.to } },
        select: { createdAt: true },
      }),
      this.prisma.task.findMany({
        where: { ...taskWhere, completedAt: { gte: range.from, lte: range.to } },
        select: { completedAt: true },
      }),
    ]);

    const buckets = this.bucketKeys(range);
    const created = new Map(buckets.map((b) => [b, 0]));
    const completed = new Map(buckets.map((b) => [b, 0]));
    for (const r of createdRows) {
      const k = this.bucketKey(r.createdAt, range.bucket);
      if (created.has(k)) created.set(k, created.get(k)! + 1);
    }
    for (const r of completedRows) {
      if (!r.completedAt) continue;
      const k = this.bucketKey(r.completedAt, range.bucket);
      if (completed.has(k)) completed.set(k, completed.get(k)! + 1);
    }

    return buckets.map((b) => ({
      date: b,
      created: created.get(b) ?? 0,
      completed: completed.get(b) ?? 0,
    }));
  }

  private bucketKey(date: Date, bucket: 'day' | 'week'): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (bucket === 'week') d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  }

  private bucketKeys(range: ResolvedRange): string[] {
    const keys: string[] = [];
    const cursor = new Date(range.from);
    cursor.setHours(0, 0, 0, 0);
    if (range.bucket === 'week') cursor.setDate(cursor.getDate() - cursor.getDay());
    const step = range.bucket === 'week' ? 7 : 1;
    let guard = 0;
    while (cursor <= range.to && guard < 400) {
      keys.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + step);
      guard += 1;
    }
    return keys;
  }

  /* ----------------------------- distributions ----------------------------- */

  private async distributions(taskWhere: Prisma.TaskWhereInput, range: ResolvedRange) {
    const windowWhere = { ...taskWhere, createdAt: { gte: range.from, lte: range.to } };
    const [byStatus, byPriority] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where: windowWhere, _count: { _all: true } }),
      this.prisma.task.groupBy({ by: ['priority'], where: windowWhere, _count: { _all: true } }),
    ]);
    return {
      status: byStatus.map((s) => ({ key: s.status, count: s._count._all })),
      priority: byPriority.map((p) => ({ key: p.priority, count: p._count._all })),
    };
  }

  /* ----------------------------- per-member ----------------------------- */

  private async perMember(
    members: ScopedMember[],
    range: ResolvedRange,
    dto: PerformanceQueryDto,
  ) {
    const ids = members.map((m) => m.id);
    if (ids.length === 0) return [];
    const now = new Date();

    const [createdByMember, activeByMember, overdueByMember, completedRows] =
      await Promise.all([
        this.prisma.task.groupBy({
          by: ['assigneeId'],
          where: { assigneeId: { in: ids }, createdAt: { gte: range.from, lte: range.to } },
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ['assigneeId'],
          where: { assigneeId: { in: ids }, isCompleted: false },
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ['assigneeId'],
          where: { assigneeId: { in: ids }, isCompleted: false, dueDate: { lt: now } },
          _count: { _all: true },
        }),
        this.prisma.task.findMany({
          where: {
            assigneeId: { in: ids },
            createdAt: { gte: range.from, lte: range.to },
            isCompleted: true,
            completedAt: { not: null },
          },
          select: { assigneeId: true, createdAt: true, completedAt: true, dueDate: true },
        }),
      ]);

    const totalMap = new Map(createdByMember.map((g) => [g.assigneeId, g._count._all]));
    const activeMap = new Map(activeByMember.map((g) => [g.assigneeId, g._count._all]));
    const overdueMap = new Map(overdueByMember.map((g) => [g.assigneeId, g._count._all]));

    const comp = new Map<
      string,
      { completed: number; onTime: number; withDue: number; cycleMs: number }
    >();
    for (const r of completedRows) {
      if (!r.assigneeId || !r.completedAt) continue;
      const c = comp.get(r.assigneeId) ?? { completed: 0, onTime: 0, withDue: 0, cycleMs: 0 };
      c.completed += 1;
      c.cycleMs += r.completedAt.getTime() - r.createdAt.getTime();
      if (r.dueDate) {
        c.withDue += 1;
        if (r.completedAt <= r.dueDate) c.onTime += 1;
      }
      comp.set(r.assigneeId, c);
    }

    const rows = members.map((m) => {
      const total = totalMap.get(m.id) ?? 0;
      const c = comp.get(m.id) ?? { completed: 0, onTime: 0, withDue: 0, cycleMs: 0 };
      return {
        id: m.id,
        name: `${m.firstName} ${m.lastName}`,
        email: m.email,
        role: m.role,
        department: m.department,
        profileImage: m.profileImage,
        isActive: m.isActive,
        lastActiveAt: m.lastActiveAt,
        completionRate: total ? round((c.completed / total) * 100) : 0,
        onTimeRate: c.withDue ? round((c.onTime / c.withDue) * 100) : 0,
        cycleAvgDays: c.completed ? round(c.cycleMs / c.completed / DAY_MS, 1) : 0,
        completedTasks: c.completed,
        activeTasks: activeMap.get(m.id) ?? 0,
        overdueTasks: overdueMap.get(m.id) ?? 0,
      };
    });

    const sortBy = dto.sortBy ?? 'completionRate';
    const dir = dto.sortOrder === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortBy];
      const bv = (b as Record<string, unknown>)[sortBy];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
    return rows;
  }

  /* ----------------------------- range ----------------------------- */

  private resolveRange(dto: PerformanceQueryDto): ResolvedRange {
    const preset: PerfRange = dto.range ?? '30d';
    const to = preset === 'custom' && dto.to ? new Date(dto.to) : new Date();
    let from: Date;

    if (preset === 'custom' && dto.from) {
      from = new Date(dto.from);
    } else if (preset === 'month') {
      from = new Date(to.getFullYear(), to.getMonth(), 1);
    } else if (preset === 'quarter') {
      from = new Date(to.getFullYear(), Math.floor(to.getMonth() / 3) * 3, 1);
    } else {
      const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30;
      from = new Date(to.getTime() - days * DAY_MS);
    }

    const lengthMs = Math.max(to.getTime() - from.getTime(), DAY_MS);
    const prevTo = new Date(from.getTime());
    const prevFrom = new Date(from.getTime() - lengthMs);
    const bucket: 'day' | 'week' = lengthMs <= 31 * DAY_MS ? 'day' : 'week';

    return { from, to, prevFrom, prevTo, bucket, preset };
  }
}

interface ResolvedRange {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  bucket: 'day' | 'week';
  preset: PerfRange;
}
