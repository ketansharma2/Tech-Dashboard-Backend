import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { TaskActionService } from './services/task-action.service';
import { TaskQueryService } from './services/task-query.service';
import { TaskActionDto, TaskActionType } from './dto/task-action.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(
    private readonly taskActionService: TaskActionService,
    private readonly taskQueryService: TaskQueryService,
  ) {}

  @Post('action')
  @ApiOperation({ 
    summary: 'Execute a task action',
    description: `
      Unified endpoint for all task mutations. Supports the following actions:
      - CREATE: Create a new task
      - UPDATE: Update an existing task
      - DELETE: Delete a task
      - COMPLETE: Mark task as complete
      - UNCOMPLETE: Mark task as incomplete
      - TOGGLE_IMPORTANT: Toggle important status
      - TOGGLE_MY_DAY: Toggle My Day status
      - ASSIGN: Assign task to a user
      - UNASSIGN: Remove task assignment
      - CHANGE_PRIORITY: Change task priority
      - CHANGE_STATUS: Change task status
      - CHANGE_DUE_DATE: Change task due date
      - DUPLICATE: Duplicate a task
      - ARCHIVE: Archive a task
      - RESTORE: Restore an archived task
      - BULK_UPDATE: Update multiple tasks
      - BULK_DELETE: Delete multiple tasks
      - BULK_COMPLETE: Complete multiple tasks
      - BULK_ASSIGN: Assign multiple tasks
      - ADD_STEP: Add a step to a task
      - UPDATE_STEP: Update a task step
      - DELETE_STEP: Delete a task step
      - TOGGLE_STEP: Toggle step completion
      - ADD_COMMENT: Add a comment to a task
      - UPDATE_COMMENT: Update a comment
      - DELETE_COMMENT: Delete a comment
    `
  })
  @ApiBody({
    type: TaskActionDto,
    examples: {
      create: {
        summary: 'Create Task',
        value: {
          action: 'CREATE',
          payload: {
            title: 'Homepage Design',
            description: 'Create landing page',
            priority: 'HIGH'
          }
        }
      },
      update: {
        summary: 'Update Task',
        value: {
          action: 'UPDATE',
          taskId: '123',
          payload: {
            title: 'Updated Title',
            priority: 'MEDIUM'
          }
        }
      },
      complete: {
        summary: 'Complete Task',
        value: {
          action: 'COMPLETE',
          taskId: '123'
        }
      },
      toggleImportant: {
        summary: 'Toggle Important',
        value: {
          action: 'TOGGLE_IMPORTANT',
          taskId: '123'
        }
      },
      toggleMyDay: {
        summary: 'Toggle My Day',
        value: {
          action: 'TOGGLE_MY_DAY',
          taskId: '123'
        }
      },
      assign: {
        summary: 'Assign Task',
        value: {
          action: 'ASSIGN',
          taskId: '123',
          payload: {
            assigneeId: '456'
          }
        }
      },
      bulkUpdate: {
        summary: 'Bulk Update',
        value: {
          action: 'BULK_UPDATE',
          taskIds: ['1', '2', '3'],
          payload: {
            status: 'COMPLETED'
          }
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Action executed successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid action or missing parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  executeAction(@Body() actionDto: TaskActionDto, @Request() req) {
    return this.taskActionService.execute(actionDto, req.user.userId, req.user.role);
  }

  @Get('query')
  @ApiOperation({ summary: 'Query tasks with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Tasks retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  query(@Query() queryDto: QueryTasksDto, @Request() req) {
    return this.taskQueryService.findAll(queryDto, req.user.userId, req.user.role);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tasks with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Tasks retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Query() queryDto: QueryTasksDto, @Request() req) {
    return this.taskQueryService.findAll(queryDto, req.user.userId, req.user.role);
  }

  @Get('my-day')
  @ApiOperation({ summary: 'Get My Day tasks' })
  @ApiResponse({ status: 200, description: 'My Day tasks retrieved successfully' })
  findMyDay(@Request() req) {
    const queryDto: QueryTasksDto = {
      isMyDay: true,
      isCompleted: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
    return this.taskQueryService.findAll(queryDto, req.user.userId, req.user.role);
  }

  @Get('important')
  @ApiOperation({ summary: 'Get Important tasks' })
  @ApiResponse({ status: 200, description: 'Important tasks retrieved successfully' })
  findImportant(@Request() req) {
    const queryDto: QueryTasksDto = {
      isImportant: true,
      isCompleted: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
    return this.taskQueryService.findAll(queryDto, req.user.userId, req.user.role);
  }

  @Get('planned')
  @ApiOperation({ summary: 'Get Planned tasks (tasks with due dates)' })
  @ApiResponse({ status: 200, description: 'Planned tasks retrieved successfully' })
  findPlanned(@Request() req, @Query() queryDto: QueryTasksDto) {
    const query: QueryTasksDto = {
      ...queryDto,
      dueDateFrom: queryDto.dueDateFrom || new Date(0).toISOString(),
      sortBy: 'dueDate',
      sortOrder: 'asc',
    };
    return this.taskQueryService.findAll(query, req.user.userId, req.user.role);
  }

  @Get('assigned')
  @ApiOperation({ summary: 'Get tasks assigned to current user' })
  @ApiResponse({ status: 200, description: 'Assigned tasks retrieved successfully' })
  findAssigned(@Request() req) {
    const queryDto: QueryTasksDto = {
      assigneeId: req.user.userId,
      isCompleted: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    };
    return this.taskQueryService.findAll(queryDto, req.user.userId, req.user.role);
  }

  @Get('meetings')
  @ApiOperation({ summary: 'Get Meeting tasks' })
  @ApiResponse({ status: 200, description: 'Meeting tasks retrieved successfully' })
  findMeetings(@Request() req) {
    const queryDto: QueryTasksDto = {
      isMeeting: true,
      isCompleted: false,
      sortBy: 'dueDate',
      sortOrder: 'asc',
    };
    return this.taskQueryService.findAll(queryDto, req.user.userId, req.user.role);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard summary statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard summary retrieved successfully' })
  getDashboard(@Request() req) {
    return this.taskQueryService.getDashboardSummary(req.user.userId, req.user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a task by ID' })
  @ApiResponse({ status: 200, description: 'Task retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.taskQueryService.findOne(id, req.user.userId, req.user.role);
  }
}
