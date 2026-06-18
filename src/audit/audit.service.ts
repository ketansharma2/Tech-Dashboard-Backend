import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: AuditAction;
  actorId: string;
  targetUserId?: string | null;
  metadata?: Record<string, any> | null;
}

/**
 * Centralized audit logging. Reusable across features (users today; projects,
 * reports, departments tomorrow). Writes are best-effort: a failure to record
 * an audit entry must never roll back or break the primary operation.
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
          actorId: entry.actorId,
          targetUserId: entry.targetUserId ?? null,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for action ${entry.action}`,
        error as Error,
      );
    }
  }

  /** Records several entries; used when one operation triggers multiple audit events. */
  async logMany(entries: AuditEntry[]): Promise<void> {
    await Promise.all(entries.map((entry) => this.log(entry)));
  }

  /** Activity timeline for a single user (newest first). */
  async listForTarget(targetUserId: string, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { targetUserId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }
}
