import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Task, Role } from '@prisma/client';
import { QueryTasksDto } from '../dto/query-tasks.dto';

export interface TasksQueryResult {
  data: Task[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface DashboardSummary {
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  myDayTasks: number;
  importantTasks: number;
  plannedTasks: number;
  assignedTasks: number;
  meetingTasks: number;
  overdueTasks: number;
}

@Injectable()
export class TaskQueryService {
  constructor(private prisma: PrismaService) {}

  private getTaskInclude() {
    return {
      creator: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          profileImage: true,
        },
      },
      assignee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          profileImage: true,
        },
      },
      steps: {
        orderBy: { order: 'asc' as const },
      },
      attachments: true,
      comments: {
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profileImage: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' as const },
      },
    };
  }

  private canAccessTask(task: Task, userId: string, userRole: Role): boolean {
    if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
      return true;
    }
    if (userRole === 'HOD' || userRole === 'LEAD') {
      return task.creatorId === userId || task.assigneeId === userId;
    }
    return task.creatorId === userId || task.assigneeId === userId;
  }

  async findAll(queryDto: QueryTasksDto, userId: string, userRole: Role): Promise<TasksQueryResult> {
    const {
      search,
      priority,
      status,
      assigneeId,
      isCompleted,
      isImportant,
      isMyDay,
      isMeeting,
      dueDateFrom,
      dueDateTo,
      tags,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 50,
    } = queryDto;

    const where: Prisma.TaskWhereInput = {};

    if (userRole === 'ASSOCIATE') {
      where.OR = [
        { creatorId: userId },
        { assigneeId: userId },
      ];
    } else if (userRole === 'LEAD' || userRole === 'HOD') {
      where.OR = [
        { creatorId: userId },
        { assigneeId: userId },
      ];
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } },
      ];
    }

    if (priority && priority.length > 0) {
      where.priority = { in: priority };
    }

    if (status && status.length > 0) {
      where.status = { in: status };
    }

    if (assigneeId !== undefined) {
      where.assigneeId = assigneeId;
    }

    if (isCompleted !== undefined) {
      where.isCompleted = isCompleted;
    }

    if (isImportant !== undefined) {
      where.isImportant = isImportant;
    }

    if (isMyDay !== undefined) {
      where.isMyDay = isMyDay;
    }

    if (isMeeting !== undefined) {
      where.isMeeting = isMeeting;
    }

    if (dueDateFrom || dueDateTo) {
      where.dueDate = {};
      if (dueDateFrom) {
        where.dueDate.gte = new Date(dueDateFrom);
      }
      if (dueDateTo) {
        where.dueDate.lte = new Date(dueDateTo);
      }
    }

    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }

    const orderBy: Prisma.TaskOrderByWithRelationInput = {};
    if (sortBy === 'priority') {
      orderBy.priority = sortOrder;
    } else if (sortBy === 'dueDate') {
      orderBy.dueDate = sortOrder;
    } else if (sortBy === 'title') {
      orderBy.title = sortOrder;
    } else {
      orderBy.createdAt = sortOrder;
    }

    const skip = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: this.getTaskInclude(),
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data: tasks,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId: string, userRole: Role): Promise<Task> {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: this.getTaskInclude(),
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (!this.canAccessTask(task, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to access this task');
    }

    return task;
  }

  async getDashboardSummary(userId: string, userRole: Role): Promise<DashboardSummary> {
    const where: Prisma.TaskWhereInput = {};

    if (userRole === 'ASSOCIATE') {
      where.OR = [
        { creatorId: userId },
        { assigneeId: userId },
      ];
    } else if (userRole === 'LEAD' || userRole === 'HOD') {
      where.OR = [
        { creatorId: userId },
        { assigneeId: userId },
      ];
    }

    const [
      totalTasks,
      completedTasks,
      myDayTasks,
      importantTasks,
      plannedTasks,
      assignedTasks,
      meetingTasks,
      overdueTasks,
    ] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.count({ where: { ...where, isCompleted: true } }),
      this.prisma.task.count({ where: { ...where, isMyDay: true, isCompleted: false } }),
      this.prisma.task.count({ where: { ...where, isImportant: true, isCompleted: false } }),
      this.prisma.task.count({ where: { ...where, dueDate: { not: null }, isCompleted: false } }),
      this.prisma.task.count({ where: { ...where, assigneeId: userId, isCompleted: false } }),
      this.prisma.task.count({ where: { ...where, isMeeting: true, isCompleted: false } }),
      this.prisma.task.count({
        where: {
          ...where,
          dueDate: { lt: new Date() },
          isCompleted: false,
        },
      }),
    ]);

    return {
      totalTasks,
      completedTasks,
      pendingTasks: totalTasks - completedTasks,
      myDayTasks,
      importantTasks,
      plannedTasks,
      assignedTasks,
      meetingTasks,
      overdueTasks,
    };
  }
}
