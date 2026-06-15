import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Task, Role } from '@prisma/client';
import { 
  TaskActionType, 
  TaskActionDto, 
  TaskActionResult, 
  TaskActionContext 
} from '../dto/task-action.dto';

type ActionHandler = (context: TaskActionContext) => Promise<TaskActionResult>;

@Injectable()
export class TaskActionService {
  private actionRegistry: Map<TaskActionType, ActionHandler>;

  constructor(private prisma: PrismaService) {
    this.actionRegistry = new Map();
    this.registerActions();
  }

  private registerActions(): void {
    this.actionRegistry.set(TaskActionType.CREATE, this.handleCreate.bind(this));
    this.actionRegistry.set(TaskActionType.UPDATE, this.handleUpdate.bind(this));
    this.actionRegistry.set(TaskActionType.DELETE, this.handleDelete.bind(this));
    this.actionRegistry.set(TaskActionType.COMPLETE, this.handleComplete.bind(this));
    this.actionRegistry.set(TaskActionType.UNCOMPLETE, this.handleUncomplete.bind(this));
    this.actionRegistry.set(TaskActionType.TOGGLE_IMPORTANT, this.handleToggleImportant.bind(this));
    this.actionRegistry.set(TaskActionType.TOGGLE_MY_DAY, this.handleToggleMyDay.bind(this));
    this.actionRegistry.set(TaskActionType.ASSIGN, this.handleAssign.bind(this));
    this.actionRegistry.set(TaskActionType.UNASSIGN, this.handleUnassign.bind(this));
    this.actionRegistry.set(TaskActionType.CHANGE_PRIORITY, this.handleChangePriority.bind(this));
    this.actionRegistry.set(TaskActionType.CHANGE_STATUS, this.handleChangeStatus.bind(this));
    this.actionRegistry.set(TaskActionType.CHANGE_DUE_DATE, this.handleChangeDueDate.bind(this));
    this.actionRegistry.set(TaskActionType.DUPLICATE, this.handleDuplicate.bind(this));
    this.actionRegistry.set(TaskActionType.ARCHIVE, this.handleArchive.bind(this));
    this.actionRegistry.set(TaskActionType.RESTORE, this.handleRestore.bind(this));
    this.actionRegistry.set(TaskActionType.BULK_UPDATE, this.handleBulkUpdate.bind(this));
    this.actionRegistry.set(TaskActionType.BULK_DELETE, this.handleBulkDelete.bind(this));
    this.actionRegistry.set(TaskActionType.BULK_COMPLETE, this.handleBulkComplete.bind(this));
    this.actionRegistry.set(TaskActionType.BULK_ASSIGN, this.handleBulkAssign.bind(this));
    this.actionRegistry.set(TaskActionType.ADD_STEP, this.handleAddStep.bind(this));
    this.actionRegistry.set(TaskActionType.UPDATE_STEP, this.handleUpdateStep.bind(this));
    this.actionRegistry.set(TaskActionType.DELETE_STEP, this.handleDeleteStep.bind(this));
    this.actionRegistry.set(TaskActionType.TOGGLE_STEP, this.handleToggleStep.bind(this));
    this.actionRegistry.set(TaskActionType.ADD_COMMENT, this.handleAddComment.bind(this));
    this.actionRegistry.set(TaskActionType.UPDATE_COMMENT, this.handleUpdateComment.bind(this));
    this.actionRegistry.set(TaskActionType.DELETE_COMMENT, this.handleDeleteComment.bind(this));
  }

  async execute(dto: TaskActionDto, userId: string, userRole: string): Promise<TaskActionResult> {
    const handler = this.actionRegistry.get(dto.action);
    
    if (!handler) {
      throw new BadRequestException(`Unknown action: ${dto.action}`);
    }

    const context: TaskActionContext = {
      userId,
      userRole,
      action: dto.action,
      taskId: dto.taskId,
      taskIds: dto.taskIds,
      payload: dto.payload,
    };

    this.validateContext(context);

    return handler(context);
  }

  private validateContext(context: TaskActionContext): void {
    const singleTaskActions = [
      TaskActionType.UPDATE,
      TaskActionType.DELETE,
      TaskActionType.COMPLETE,
      TaskActionType.UNCOMPLETE,
      TaskActionType.TOGGLE_IMPORTANT,
      TaskActionType.TOGGLE_MY_DAY,
      TaskActionType.ASSIGN,
      TaskActionType.UNASSIGN,
      TaskActionType.CHANGE_PRIORITY,
      TaskActionType.CHANGE_STATUS,
      TaskActionType.CHANGE_DUE_DATE,
      TaskActionType.DUPLICATE,
      TaskActionType.ARCHIVE,
      TaskActionType.RESTORE,
      TaskActionType.ADD_STEP,
      TaskActionType.UPDATE_STEP,
      TaskActionType.DELETE_STEP,
      TaskActionType.TOGGLE_STEP,
      TaskActionType.ADD_COMMENT,
      TaskActionType.UPDATE_COMMENT,
      TaskActionType.DELETE_COMMENT,
    ];

    const bulkActions = [
      TaskActionType.BULK_UPDATE,
      TaskActionType.BULK_DELETE,
      TaskActionType.BULK_COMPLETE,
      TaskActionType.BULK_ASSIGN,
    ];

    if (singleTaskActions.includes(context.action) && !context.taskId) {
      throw new BadRequestException(`taskId is required for action: ${context.action}`);
    }

    if (bulkActions.includes(context.action) && (!context.taskIds || context.taskIds.length === 0)) {
      throw new BadRequestException(`taskIds is required for action: ${context.action}`);
    }
  }

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

  private canAccessTask(task: Task, userId: string, userRole: string): boolean {
    if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
      return true;
    }
    if (userRole === 'HOD' || userRole === 'LEAD') {
      return task.creatorId === userId || task.assigneeId === userId;
    }
    return task.creatorId === userId || task.assigneeId === userId;
  }

  private async getTaskOrThrow(taskId: string, userId: string, userRole: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (!this.canAccessTask(task, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to access this task');
    }

    return task;
  }

  private async handleCreate(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, payload } = context;
    
    if (!payload?.title) {
      throw new BadRequestException('Title is required for CREATE action');
    }

    const data: Prisma.TaskCreateInput = {
      title: payload.title,
      description: payload.description,
      priority: payload.priority || 'MEDIUM',
      isImportant: payload.isImportant || false,
      isMyDay: payload.isMyDay || false,
      isMeeting: payload.isMeeting || false,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      dueTime: payload.dueTime,
      meetingUrl: payload.meetingUrl,
      meetingStartTime: payload.meetingStartTime,
      meetingEndTime: payload.meetingEndTime,
      tags: payload.tags || [],
      creator: {
        connect: { id: userId },
      },
    };

    if (payload.assigneeId) {
      data.assignee = {
        connect: { id: payload.assigneeId },
      };
    }

    if (payload.steps && payload.steps.length > 0) {
      data.steps = {
        create: payload.steps.map((step: any, index: number) => ({
          title: step.title,
          isCompleted: step.isCompleted || false,
          order: step.order !== undefined ? step.order : index,
        })),
      };
    }

    const task = await this.prisma.task.create({
      data,
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.CREATE,
      data: task,
      message: 'Task created successfully',
    };
  }

  private async handleUpdate(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    const data: Prisma.TaskUpdateInput = {};

    if (payload?.title !== undefined) data.title = payload.title;
    if (payload?.description !== undefined) data.description = payload.description;
    if (payload?.priority !== undefined) data.priority = payload.priority;
    if (payload?.status !== undefined) data.status = payload.status;
    if (payload?.isImportant !== undefined) data.isImportant = payload.isImportant;
    if (payload?.isMyDay !== undefined) data.isMyDay = payload.isMyDay;
    if (payload?.isMeeting !== undefined) data.isMeeting = payload.isMeeting;
    if (payload?.meetingUrl !== undefined) data.meetingUrl = payload.meetingUrl;
    if (payload?.meetingStartTime !== undefined) data.meetingStartTime = payload.meetingStartTime;
    if (payload?.meetingEndTime !== undefined) data.meetingEndTime = payload.meetingEndTime;
    if (payload?.tags !== undefined) data.tags = payload.tags;
    if (payload?.dueTime !== undefined) data.dueTime = payload.dueTime;
    if (payload?.reminderAt !== undefined) {
      data.reminderAt = payload.reminderAt ? new Date(payload.reminderAt) : null;
    }
    if (payload?.dueDate !== undefined) {
      data.dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
    }
    if (payload?.assigneeId !== undefined) {
      if (payload.assigneeId === null) {
        data.assignee = { disconnect: true };
      } else {
        data.assignee = { connect: { id: payload.assigneeId } };
      }
    }
    if (payload?.isCompleted !== undefined) {
      data.isCompleted = payload.isCompleted;
      if (payload.isCompleted) {
        data.completedAt = new Date();
        data.status = 'COMPLETED';
      } else {
        data.completedAt = null;
        data.status = 'TODO';
      }
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data,
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.UPDATE,
      data: task,
      message: 'Task updated successfully',
    };
  }

  private async handleDelete(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    await this.prisma.task.delete({ where: { id: taskId } });

    return {
      success: true,
      action: TaskActionType.DELETE,
      data: { id: taskId },
      message: 'Task deleted successfully',
    };
  }

  private async handleComplete(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        status: 'COMPLETED',
      },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.COMPLETE,
      data: task,
      message: 'Task completed successfully',
    };
  }

  private async handleUncomplete(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId } = context;
    
    const existingTask = await this.getTaskOrThrow(taskId!, userId, userRole);

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        isCompleted: false,
        completedAt: null,
        status: existingTask.status === 'COMPLETED' ? 'TODO' : existingTask.status,
      },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.UNCOMPLETE,
      data: task,
      message: 'Task marked as incomplete',
    };
  }

  private async handleToggleImportant(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    const existingTask = await this.getTaskOrThrow(taskId!, userId, userRole);
    const newValue = payload?.isImportant !== undefined ? payload.isImportant : !existingTask.isImportant;

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { isImportant: newValue },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.TOGGLE_IMPORTANT,
      data: task,
      message: newValue ? 'Task marked as important' : 'Task removed from important',
    };
  }

  private async handleToggleMyDay(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    const existingTask = await this.getTaskOrThrow(taskId!, userId, userRole);
    const newValue = payload?.isMyDay !== undefined ? payload.isMyDay : !existingTask.isMyDay;

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { isMyDay: newValue },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.TOGGLE_MY_DAY,
      data: task,
      message: newValue ? 'Task added to My Day' : 'Task removed from My Day',
    };
  }

  private async handleAssign(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    const existingTask = await this.getTaskOrThrow(taskId!, userId, userRole);

    if (userRole === 'ASSOCIATE' && existingTask.creatorId !== userId) {
      throw new ForbiddenException('You do not have permission to assign this task');
    }

    if (!payload?.assigneeId) {
      throw new BadRequestException('assigneeId is required for ASSIGN action');
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        assignee: { connect: { id: payload.assigneeId } },
      },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.ASSIGN,
      data: task,
      message: 'Task assigned successfully',
    };
  }

  private async handleUnassign(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId } = context;
    
    const existingTask = await this.getTaskOrThrow(taskId!, userId, userRole);

    if (userRole === 'ASSOCIATE' && existingTask.creatorId !== userId) {
      throw new ForbiddenException('You do not have permission to unassign this task');
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        assignee: { disconnect: true },
      },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.UNASSIGN,
      data: task,
      message: 'Task unassigned successfully',
    };
  }

  private async handleChangePriority(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.priority) {
      throw new BadRequestException('priority is required for CHANGE_PRIORITY action');
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { priority: payload.priority },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.CHANGE_PRIORITY,
      data: task,
      message: 'Task priority changed successfully',
    };
  }

  private async handleChangeStatus(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.status) {
      throw new BadRequestException('status is required for CHANGE_STATUS action');
    }

    const data: Prisma.TaskUpdateInput = { status: payload.status };
    
    if (payload.status === 'COMPLETED') {
      data.isCompleted = true;
      data.completedAt = new Date();
    } else {
      data.isCompleted = false;
      data.completedAt = null;
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data,
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.CHANGE_STATUS,
      data: task,
      message: 'Task status changed successfully',
    };
  }

  private async handleChangeDueDate(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        dueDate: payload?.dueDate ? new Date(payload.dueDate) : null,
        dueTime: payload?.dueTime !== undefined ? payload.dueTime : undefined,
      },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.CHANGE_DUE_DATE,
      data: task,
      message: 'Task due date changed successfully',
    };
  }

  private async handleDuplicate(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId } = context;
    
    const existingTask = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { steps: true },
    });

    if (!existingTask) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    if (!this.canAccessTask(existingTask, userId, userRole)) {
      throw new ForbiddenException('You do not have permission to duplicate this task');
    }

    const data: Prisma.TaskCreateInput = {
      title: `${existingTask.title} (Copy)`,
      description: existingTask.description,
      priority: existingTask.priority,
      isImportant: existingTask.isImportant,
      isMyDay: false,
      isMeeting: existingTask.isMeeting,
      dueDate: existingTask.dueDate,
      dueTime: existingTask.dueTime,
      meetingUrl: existingTask.meetingUrl,
      meetingStartTime: existingTask.meetingStartTime,
      meetingEndTime: existingTask.meetingEndTime,
      tags: existingTask.tags,
      creator: { connect: { id: userId } },
    };

    if (existingTask.steps && existingTask.steps.length > 0) {
      data.steps = {
        create: existingTask.steps.map((step) => ({
          title: step.title,
          isCompleted: false,
          order: step.order,
        })),
      };
    }

    const task = await this.prisma.task.create({
      data,
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.DUPLICATE,
      data: task,
      message: 'Task duplicated successfully',
    };
  }

  private async handleArchive(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'CANCELLED' },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.ARCHIVE,
      data: task,
      message: 'Task archived successfully',
    };
  }

  private async handleRestore(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'TODO' },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.RESTORE,
      data: task,
      message: 'Task restored successfully',
    };
  }

  private async handleBulkUpdate(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskIds, payload } = context;
    
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
    });

    const accessibleTaskIds = tasks
      .filter((task) => this.canAccessTask(task, userId, userRole))
      .map((task) => task.id);

    if (accessibleTaskIds.length === 0) {
      throw new ForbiddenException('You do not have permission to update any of these tasks');
    }

    const data: Prisma.TaskUpdateInput = {};
    if (payload?.priority !== undefined) data.priority = payload.priority;
    if (payload?.status !== undefined) {
      data.status = payload.status;
      if (payload.status === 'COMPLETED') {
        data.isCompleted = true;
        data.completedAt = new Date();
      }
    }
    if (payload?.isImportant !== undefined) data.isImportant = payload.isImportant;
    if (payload?.isMyDay !== undefined) data.isMyDay = payload.isMyDay;
    if (payload?.dueDate !== undefined) {
      data.dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
    }

    const result = await this.prisma.task.updateMany({
      where: { id: { in: accessibleTaskIds } },
      data,
    });

    const updatedTasks = await this.prisma.task.findMany({
      where: { id: { in: accessibleTaskIds } },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.BULK_UPDATE,
      data: updatedTasks,
      affected: result.count,
      message: `${result.count} tasks updated successfully`,
    };
  }

  private async handleBulkDelete(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskIds } = context;
    
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
    });

    const accessibleTaskIds = tasks
      .filter((task) => this.canAccessTask(task, userId, userRole))
      .map((task) => task.id);

    if (accessibleTaskIds.length === 0) {
      throw new ForbiddenException('You do not have permission to delete any of these tasks');
    }

    const result = await this.prisma.task.deleteMany({
      where: { id: { in: accessibleTaskIds } },
    });

    return {
      success: true,
      action: TaskActionType.BULK_DELETE,
      data: { deletedIds: accessibleTaskIds },
      affected: result.count,
      message: `${result.count} tasks deleted successfully`,
    };
  }

  private async handleBulkComplete(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskIds, payload } = context;
    
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
    });

    const accessibleTaskIds = tasks
      .filter((task) => this.canAccessTask(task, userId, userRole))
      .map((task) => task.id);

    if (accessibleTaskIds.length === 0) {
      throw new ForbiddenException('You do not have permission to update any of these tasks');
    }

    const isCompleted = payload?.isCompleted !== undefined ? payload.isCompleted : true;

    const result = await this.prisma.task.updateMany({
      where: { id: { in: accessibleTaskIds } },
      data: {
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
        status: isCompleted ? 'COMPLETED' : 'TODO',
      },
    });

    const updatedTasks = await this.prisma.task.findMany({
      where: { id: { in: accessibleTaskIds } },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.BULK_COMPLETE,
      data: updatedTasks,
      affected: result.count,
      message: `${result.count} tasks ${isCompleted ? 'completed' : 'uncompleted'} successfully`,
    };
  }

  private async handleBulkAssign(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskIds, payload } = context;
    
    if (!payload?.assigneeId) {
      throw new BadRequestException('assigneeId is required for BULK_ASSIGN action');
    }

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds } },
    });

    const accessibleTaskIds = tasks
      .filter((task) => {
        if (userRole === 'ASSOCIATE') {
          return task.creatorId === userId;
        }
        return this.canAccessTask(task, userId, userRole);
      })
      .map((task) => task.id);

    if (accessibleTaskIds.length === 0) {
      throw new ForbiddenException('You do not have permission to assign any of these tasks');
    }

    const result = await this.prisma.task.updateMany({
      where: { id: { in: accessibleTaskIds } },
      data: { assigneeId: payload.assigneeId },
    });

    const updatedTasks = await this.prisma.task.findMany({
      where: { id: { in: accessibleTaskIds } },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.BULK_ASSIGN,
      data: updatedTasks,
      affected: result.count,
      message: `${result.count} tasks assigned successfully`,
    };
  }

  private async handleAddStep(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.title) {
      throw new BadRequestException('title is required for ADD_STEP action');
    }

    const lastStep = await this.prisma.taskStep.findFirst({
      where: { taskId },
      orderBy: { order: 'desc' },
    });

    const step = await this.prisma.taskStep.create({
      data: {
        title: payload.title,
        isCompleted: payload.isCompleted || false,
        order: (lastStep?.order ?? -1) + 1,
        task: { connect: { id: taskId } },
      },
    });

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.ADD_STEP,
      data: task,
      message: 'Step added successfully',
    };
  }

  private async handleUpdateStep(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.stepId) {
      throw new BadRequestException('stepId is required for UPDATE_STEP action');
    }

    const updateData: any = {};
    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.isCompleted !== undefined) updateData.isCompleted = payload.isCompleted;
    if (payload.order !== undefined) updateData.order = payload.order;

    await this.prisma.taskStep.update({
      where: { id: payload.stepId },
      data: updateData,
    });

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.UPDATE_STEP,
      data: task,
      message: 'Step updated successfully',
    };
  }

  private async handleDeleteStep(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.stepId) {
      throw new BadRequestException('stepId is required for DELETE_STEP action');
    }

    await this.prisma.taskStep.delete({
      where: { id: payload.stepId },
    });

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.DELETE_STEP,
      data: task,
      message: 'Step deleted successfully',
    };
  }

  private async handleToggleStep(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.stepId) {
      throw new BadRequestException('stepId is required for TOGGLE_STEP action');
    }

    const step = await this.prisma.taskStep.findUnique({
      where: { id: payload.stepId },
    });

    if (!step) {
      throw new NotFoundException(`Step with ID ${payload.stepId} not found`);
    }

    await this.prisma.taskStep.update({
      where: { id: payload.stepId },
      data: { isCompleted: !step.isCompleted },
    });

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.TOGGLE_STEP,
      data: task,
      message: 'Step toggled successfully',
    };
  }

  private async handleAddComment(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.content) {
      throw new BadRequestException('content is required for ADD_COMMENT action');
    }

    await this.prisma.taskComment.create({
      data: {
        content: payload.content,
        task: { connect: { id: taskId } },
        author: { connect: { id: userId } },
      },
    });

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.ADD_COMMENT,
      data: task,
      message: 'Comment added successfully',
    };
  }

  private async handleUpdateComment(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.commentId) {
      throw new BadRequestException('commentId is required for UPDATE_COMMENT action');
    }

    if (!payload?.content) {
      throw new BadRequestException('content is required for UPDATE_COMMENT action');
    }

    const comment = await this.prisma.taskComment.findUnique({
      where: { id: payload.commentId },
    });

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${payload.commentId} not found`);
    }

    if (comment.authorId !== userId && userRole !== 'SUPERADMIN' && userRole !== 'ADMIN') {
      throw new ForbiddenException('You can only edit your own comments');
    }

    await this.prisma.taskComment.update({
      where: { id: payload.commentId },
      data: { content: payload.content },
    });

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.UPDATE_COMMENT,
      data: task,
      message: 'Comment updated successfully',
    };
  }

  private async handleDeleteComment(context: TaskActionContext): Promise<TaskActionResult> {
    const { userId, userRole, taskId, payload } = context;
    
    await this.getTaskOrThrow(taskId!, userId, userRole);

    if (!payload?.commentId) {
      throw new BadRequestException('commentId is required for DELETE_COMMENT action');
    }

    const comment = await this.prisma.taskComment.findUnique({
      where: { id: payload.commentId },
    });

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${payload.commentId} not found`);
    }

    if (comment.authorId !== userId && userRole !== 'SUPERADMIN' && userRole !== 'ADMIN') {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.taskComment.delete({
      where: { id: payload.commentId },
    });

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: this.getTaskInclude(),
    });

    return {
      success: true,
      action: TaskActionType.DELETE_COMMENT,
      data: task,
      message: 'Comment deleted successfully',
    };
  }
}
