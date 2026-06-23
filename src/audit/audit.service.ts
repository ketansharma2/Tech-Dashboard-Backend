import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actorId: string;
  entityType?: string | null;
  entityId?: string | null;
  targetUserId?: string | null;
  oldValues?: Record<string, any> | null;
  newValues?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditQueryFilters {
  search?: string;
  action?: string;
  entityType?: string;
  actorId?: string;
  targetUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

const ACTOR_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true, role: true },
};

const asJson = (v: Record<string, any> | null | undefined) =>
  (v ?? undefined) as Prisma.InputJsonValue | undefined;

/**
 * Centralized, enterprise audit logging + querying. Writes are best-effort — a
 * failure to record audit must never break the primary operation. Reusable
 * across every feature module.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          actorId: entry.actorId,
          targetUserId: entry.targetUserId ?? null,
          oldValues: asJson(entry.oldValues),
          newValues: asJson(entry.newValues),
          metadata: asJson(entry.metadata),
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log "${entry.action}"`, error as Error);
    }
  }

  async logMany(entries: AuditEntry[]): Promise<void> {
    await Promise.all(entries.map((e) => this.log(e)));
  }

  /** Activity timeline for a single target user (newest first). */
  async listForTarget(targetUserId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { targetUserId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: ACTOR_SELECT },
    });
  }

  /** Actions performed BY a user (their own activity). */
  async listByActor(actorId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { actorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: ACTOR_SELECT },
    });
  }

  /** Paginated, filterable audit query for the Audit Log page. */
  async query(filters: AuditQueryFilters) {
    const { page = 1, limit = 25 } = filters;
    const where: Prisma.AuditLogWhereInput = {};

    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.targetUserId) where.targetUserId = filters.targetUserId;
    if (filters.search) {
      where.OR = [
        { action: { contains: filters.search, mode: 'insensitive' } },
        { entityType: { contains: filters.search, mode: 'insensitive' } },
        { entityId: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: ACTOR_SELECT, targetUser: ACTOR_SELECT },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getById(id: string) {
    return this.prisma.auditLog.findUnique({
      where: { id },
      include: { actor: ACTOR_SELECT, targetUser: ACTOR_SELECT },
    });
  }

  /* ----------------------------- login history ----------------------------- */

  async recordLogin(
    userId: string,
    type: 'LOGIN' | 'LOGOUT' | 'FAILED',
    ctx?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<void> {
    try {
      await this.prisma.loginEvent.create({
        data: {
          userId,
          type,
          ipAddress: ctx?.ipAddress ?? null,
          userAgent: ctx?.userAgent ?? null,
        },
      });
      if (type === 'LOGIN') {
        await this.prisma.user.update({
          where: { id: userId },
          data: { lastActiveAt: new Date() },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to record login event for ${userId}`, error as Error);
    }
  }

  async listLoginHistory(userId: string, limit = 50) {
    return this.prisma.loginEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
