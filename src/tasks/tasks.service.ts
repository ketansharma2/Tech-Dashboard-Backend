import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { Prisma, Task, Role } from '@prisma/client';

@Injectable()
export class TasksService {
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
    // SuperAdmin and Admin can access all tasks
    if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
      return true;
    }

    // HOD and LEAD can access tasks they created or are assigned to
    if (userRole === 'HOD' || userRole === 'LEAD') {
      return task.creatorId === userId || task.assigneeId === userId;
    }

    // Associates can only access their own tasks
    return task.creatorId === userId || task.assigneeId === userId;
  }

  async create(createTaskDto: CreateTaskDto, userId: string) {
    const data: Prisma.TaskCreateInput = {
      title: createTaskDto.title,
      description: createTaskDto.description,
      priority: createTaskDto.priority || 'MEDIUM',
      isImportant: createTaskDto.isImportant || false,
      isMyDay: createTaskDto.isMyDay || false,
      isMeeting: createTaskDto.isMeeting || false,
      dueDate: createTaskDto.dueDate ? new Date(createTaskDto.dueDate) : null,
      dueTime: createTaskDto.dueTime,
      meetingUrl: createTaskDto.meetingUrl,
      meetingStartTime: createTaskDto.meetingStartTime,
      meetingEndTime: createTaskDto.meetingEndTime,
      tags: createTaskDto.tags || [],
      creator: {
        connect: { id: userId },
      },
    };

    if (createTaskDto.assigneeId) {
      data.assignee = {
        connect: { id: createTaskDto.assigneeId },
      };
    }

    if (createTaskDto.steps && createTaskDto.steps.length > 0) {
      data.steps = {
        create: createTaskDto.steps.map((step, index) => ({
          title: step.title,
          isCompleted: step.isCompleted || false,
          order: step.order !== undefined ? step.order : index,
        })),
      };
    }

    return this.prisma.task.create({
      data,
      include: this.getTaskInclude(),
    });
  }

  async findAll(queryDto: QueryTasksDto, userId: string, userRole: Role) {
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

    // Role-based filtering
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
    // SUPERADMIN and ADMIN can see all tasks (no additional filter)

    // Search
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } },
      ];
    }

    // Filters
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

    // Sorting
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

    // Pagination
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

  async findOne(id: string, userId: string, userRole: Role) {
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

  async update(id: string, updateTaskDto: UpdateTaskDto, userId: string, userRole: Role) {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (!this.canAccessTask(task, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to update this task');
    }

    const data: Prisma.TaskUpdateInput = {};

    if (updateTaskDto.title !== undefined) data.title = updateTaskDto.title;
    if (updateTaskDto.description !== undefined) data.description = updateTaskDto.description;
    if (updateTaskDto.priority !== undefined) data.priority = updateTaskDto.priority;
    if (updateTaskDto.status !== undefined) data.status = updateTaskDto.status;
    if (updateTaskDto.isImportant !== undefined) data.isImportant = updateTaskDto.isImportant;
    if (updateTaskDto.isMyDay !== undefined) data.isMyDay = updateTaskDto.isMyDay;
    if (updateTaskDto.isMeeting !== undefined) data.isMeeting = updateTaskDto.isMeeting;
    if (updateTaskDto.meetingUrl !== undefined) data.meetingUrl = updateTaskDto.meetingUrl;
    if (updateTaskDto.meetingStartTime !== undefined) data.meetingStartTime = updateTaskDto.meetingStartTime;
    if (updateTaskDto.meetingEndTime !== undefined) data.meetingEndTime = updateTaskDto.meetingEndTime;
    if (updateTaskDto.tags !== undefined) data.tags = updateTaskDto.tags;
    if (updateTaskDto.dueTime !== undefined) data.dueTime = updateTaskDto.dueTime;
    if (updateTaskDto.reminderAt !== undefined) {
      data.reminderAt = updateTaskDto.reminderAt ? new Date(updateTaskDto.reminderAt) : null;
    }

    if (updateTaskDto.dueDate !== undefined) {
      data.dueDate = updateTaskDto.dueDate ? new Date(updateTaskDto.dueDate) : null;
    }

    if (updateTaskDto.assigneeId !== undefined) {
      if (updateTaskDto.assigneeId === null) {
        data.assignee = { disconnect: true };
      } else {
        data.assignee = { connect: { id: updateTaskDto.assigneeId } };
      }
    }

    if (updateTaskDto.isCompleted !== undefined) {
      data.isCompleted = updateTaskDto.isCompleted;
      if (updateTaskDto.isCompleted) {
        data.completedAt = new Date();
        data.status = 'COMPLETED';
      } else {
        data.completedAt = null;
        if (task.status === 'COMPLETED') {
          data.status = 'TODO';
        }
      }
    }

    return this.prisma.task.update({
      where: { id },
      data,
      include: this.getTaskInclude(),
    });
  }

  async remove(id: string, userId: string, userRole: Role) {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (!this.canAccessTask(task, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to delete this task');
    }

    await this.prisma.task.delete({ where: { id } });
    return { message: 'Task deleted successfully' };
  }

  async toggleComplete(id: string, isCompleted: boolean, userId: string, userRole: Role) {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (!this.canAccessTask(task, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to update this task');
    }

    return this.prisma.task.update({
      where: { id },
      data: {
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
        status: isCompleted ? 'COMPLETED' : (task.status === 'COMPLETED' ? 'TODO' : task.status),
      },
      include: this.getTaskInclude(),
    });
  }

  async toggleImportant(id: string, isImportant: boolean, userId: string, userRole: Role) {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (!this.canAccessTask(task, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to update this task');
    }

    return this.prisma.task.update({
      where: { id },
      data: { isImportant },
      include: this.getTaskInclude(),
    });
  }

  async toggleMyDay(id: string, isMyDay: boolean, userId: string, userRole: Role) {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (!this.canAccessTask(task, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to update this task');
    }

    return this.prisma.task.update({
      where: { id },
      data: { isMyDay },
      include: this.getTaskInclude(),
    });
  }

  async assignTask(id: string, assigneeId: string | null, userId: string, userRole: Role) {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    // Only creator, HOD, LEAD, ADMIN, or SUPERADMIN can assign tasks
    if (userRole === 'ASSOCIATE' && task.creatorId !== userId) {
      throw new ForbiddenException('You do not have permission to assign this task');
    }

    const data: Prisma.TaskUpdateInput = {};
    if (assigneeId === null) {
      data.assignee = { disconnect: true };
    } else {
      data.assignee = { connect: { id: assigneeId } };
    }

    return this.prisma.task.update({
      where: { id },
      data,
      include: this.getTaskInclude(),
    });
  }

  async getDashboardSummary(userId: string, userRole: Role) {
    const where: Prisma.TaskWhereInput = {};

    // Role-based filtering
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
