import { ForbiddenException, Injectable } from '@nestjs/common';
import { Department, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const SCOPED_MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  department: true,
  profileImage: true,
  isActive: true,
  lastActiveAt: true,
  managerId: true,
} satisfies Prisma.UserSelect;

export type ScopedMember = Prisma.UserGetPayload<{ select: typeof SCOPED_MEMBER_SELECT }>;

export interface PerformanceScope {
  /** Effective department used for KPI-target resolution (null = whole org). */
  department: Department | null;
  /** Tasks assigned to in-scope members. */
  taskWhere: Prisma.TaskWhereInput;
  /** Resolved member records (for the member table / workload). */
  members: ScopedMember[];
}

/**
 * Resolves who a viewer is allowed to see, derived from the existing org
 * hierarchy (no Team entity):
 *   ADMIN/SUPERADMIN -> everyone (optionally filtered by department)
 *   HOD              -> their department
 *   LEAD             -> their direct reports + themselves
 * Used by both the dashboard query and the member-detail scope check.
 */
@Injectable()
export class PerformanceScopeService {
  constructor(private prisma: PrismaService) {}

  async resolve(
    actorId: string,
    actorRole: Role,
    departmentFilter?: Department,
  ): Promise<PerformanceScope> {
    let memberWhere: Prisma.UserWhereInput;
    let department: Department | null;

    if (actorRole === 'SUPERADMIN' || actorRole === 'ADMIN') {
      department = departmentFilter ?? null;
      memberWhere = department ? { department } : {};
    } else if (actorRole === 'HOD') {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        select: { department: true },
      });
      department = actor?.department ?? null;
      // No department assigned -> sees nobody.
      memberWhere = department ? { department } : { id: '__none__' };
    } else if (actorRole === 'LEAD') {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        select: { department: true },
      });
      department = actor?.department ?? null;
      memberWhere = { OR: [{ managerId: actorId }, { id: actorId }] };
    } else {
      throw new ForbiddenException('You do not have access to the performance dashboard');
    }

    const members = await this.prisma.user.findMany({
      where: memberWhere,
      select: SCOPED_MEMBER_SELECT,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    // Tasks whose (non-null) assignee is within scope.
    const taskWhere: Prisma.TaskWhereInput = { assignee: memberWhere };

    return { department, taskWhere, members };
  }

  assertMemberInScope(memberId: string, scope: PerformanceScope): ScopedMember {
    const member = scope.members.find((m) => m.id === memberId);
    if (!member) {
      throw new ForbiddenException('This member is outside your access scope');
    }
    return member;
  }
}
