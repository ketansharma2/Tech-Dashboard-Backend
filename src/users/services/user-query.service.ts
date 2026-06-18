import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { UserQueryDto } from '../dto/user-query.dto';
import { USER_SELECT, SanitizedUser } from '../user.select';

export interface UserListResult {
  data: SanitizedUser[];
  meta: { total: number; page: number; limit: number; totalPages: number };
  stats?: { total: number; active: number; inactive: number; admins: number };
  facets?: { managers: { id: string; name: string }[] };
}

export interface SingleUserResult {
  data: SanitizedUser;
  activity?: Awaited<ReturnType<AuditService['listForTarget']>>;
  taskStats?: {
    assignedProjects: number;
    assignedTasks: number;
    completedTasks: number;
    upcomingMeetings: number;
  };
}

@Injectable()
export class UserQueryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Builds the role-based visibility scope. This is applied to EVERY query so a
   * caller can never see beyond what their role permits, regardless of filters.
   *
   *  SUPERADMIN → all users
   *  ADMIN      → all users except SUPERADMIN
   *  HOD        → users in the HOD's department
   *  LEAD       → the lead's direct reports + themselves
   *  ASSOCIATE  → ForbiddenException
   */
  private async buildScopeWhere(
    actorId: string,
    actorRole: Role,
  ): Promise<Prisma.UserWhereInput> {
    switch (actorRole) {
      case 'SUPERADMIN':
        return {};
      case 'ADMIN':
        return { NOT: { role: 'SUPERADMIN' } };
      case 'HOD': {
        const actor = await this.prisma.user.findUnique({
          where: { id: actorId },
          select: { department: true },
        });
        // No department assigned → can see nobody.
        if (!actor?.department) return { id: '__none__' };
        return { department: actor.department, NOT: { role: 'SUPERADMIN' } };
      }
      case 'LEAD':
        return { OR: [{ managerId: actorId }, { id: actorId }] };
      case 'ASSOCIATE':
      default:
        throw new ForbiddenException(
          'You do not have access to user management',
        );
    }
  }

  async query(
    dto: UserQueryDto,
    actorId: string,
    actorRole: Role,
  ): Promise<UserListResult | SingleUserResult> {
    const scopeWhere = await this.buildScopeWhere(actorId, actorRole);

    // Single-user (detail) mode.
    if (dto.userId) {
      return this.findOneScoped(dto, scopeWhere);
    }

    return this.findManyScoped(dto, scopeWhere, actorRole);
  }

  private async findOneScoped(
    dto: UserQueryDto,
    scopeWhere: Prisma.UserWhereInput,
  ): Promise<SingleUserResult> {
    const user = await this.prisma.user.findFirst({
      where: { AND: [scopeWhere, { id: dto.userId }] },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found or outside your access scope');
    }

    const result: SingleUserResult = { data: user };

    if (dto.includeActivity) {
      result.activity = await this.audit.listForTarget(user.id);
    }

    result.taskStats = await this.computeTaskStats(user.id);
    return result;
  }

  private async findManyScoped(
    dto: UserQueryDto,
    scopeWhere: Prisma.UserWhereInput,
    actorRole: Role,
  ): Promise<UserListResult> {
    const {
      search,
      role,
      department,
      managerId,
      isActive,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = dto;

    // Dynamic filters layered on top of the role scope.
    const filters: Prisma.UserWhereInput[] = [scopeWhere];

    if (search) {
      filters.push({
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (role && role.length > 0) filters.push({ role: { in: role } });
    if (department) filters.push({ department });
    if (managerId) filters.push({ managerId });
    if (isActive !== undefined) filters.push({ isActive });

    const where: Prisma.UserWhereInput = { AND: filters };

    const orderBy: Prisma.UserOrderByWithRelationInput = {};
    if (sortBy === 'firstName') orderBy.firstName = sortOrder;
    else if (sortBy === 'lastName') orderBy.lastName = sortOrder;
    else if (sortBy === 'role') orderBy.role = sortOrder;
    else if (sortBy === 'department') orderBy.department = sortOrder;
    else orderBy.createdAt = sortOrder;

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const result: UserListResult = {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };

    if (dto.includeStats) {
      result.stats = await this.computeStats(scopeWhere);
      result.facets = { managers: await this.listManagers(scopeWhere) };
    }

    return result;
  }

  /** Summary stats across the caller's full visible scope (ignores filters). */
  private async computeStats(scopeWhere: Prisma.UserWhereInput) {
    const [total, active, admins] = await Promise.all([
      this.prisma.user.count({ where: scopeWhere }),
      this.prisma.user.count({ where: { AND: [scopeWhere, { isActive: true }] } }),
      this.prisma.user.count({
        where: { AND: [scopeWhere, { role: { in: ['SUPERADMIN', 'ADMIN'] } }] },
      }),
    ]);
    return { total, active, inactive: total - active, admins };
  }

  /** In-scope users who can be managers, for the filter dropdown. */
  private async listManagers(scopeWhere: Prisma.UserWhereInput) {
    const managers = await this.prisma.user.findMany({
      where: {
        AND: [scopeWhere, { role: { in: ['SUPERADMIN', 'ADMIN', 'HOD', 'LEAD'] } }],
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return managers.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` }));
  }

  /** Task-derived stats for the user detail view (Projects model not yet present). */
  private async computeTaskStats(userId: string) {
    const now = new Date();
    const [assignedTasks, completedTasks, upcomingMeetings] = await Promise.all([
      this.prisma.task.count({ where: { assigneeId: userId } }),
      this.prisma.task.count({ where: { assigneeId: userId, isCompleted: true } }),
      this.prisma.task.count({
        where: {
          assigneeId: userId,
          isMeeting: true,
          isCompleted: false,
          dueDate: { gte: now },
        },
      }),
    ]);
    return { assignedProjects: 0, assignedTasks, completedTasks, upcomingMeetings };
  }
}
