import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import {
  ToggleTaskCompleteDto,
  ToggleTaskImportantDto,
  ToggleTaskMyDayDto,
  AssignTaskDto,
} from './dto/toggle-task.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Body() createTaskDto: CreateTaskDto, @Request() req) {
    return this.tasksService.create(createTaskDto, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tasks with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Tasks retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Query() queryDto: QueryTasksDto, @Request() req) {
    return this.tasksService.findAll(queryDto, req.user.userId, req.user.role);
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
    return this.tasksService.findAll(queryDto, req.user.userId, req.user.role);
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
    return this.tasksService.findAll(queryDto, req.user.userId, req.user.role);
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
    return this.tasksService.findAll(query, req.user.userId, req.user.role);
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
    return this.tasksService.findAll(queryDto, req.user.userId, req.user.role);
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
    return this.tasksService.findAll(queryDto, req.user.userId, req.user.role);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard summary statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard summary retrieved successfully' })
  getDashboard(@Request() req) {
    return this.tasksService.getDashboardSummary(req.user.userId, req.user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a task by ID' })
  @ApiResponse({ status: 200, description: 'Task retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.tasksService.findOne(id, req.user.userId, req.user.role);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({ status: 200, description: 'Task updated successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  update(
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @Request() req,
  ) {
    return this.tasksService.update(id, updateTaskDto, req.user.userId, req.user.role);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a task' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  remove(@Param('id') id: string, @Request() req) {
    return this.tasksService.remove(id, req.user.userId, req.user.role);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Toggle task completion status' })
  @ApiResponse({ status: 200, description: 'Task completion toggled successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  toggleComplete(
    @Param('id') id: string,
    @Body() dto: ToggleTaskCompleteDto,
    @Request() req,
  ) {
    return this.tasksService.toggleComplete(id, dto.isCompleted, req.user.userId, req.user.role);
  }

  @Patch(':id/important')
  @ApiOperation({ summary: 'Toggle task important status' })
  @ApiResponse({ status: 200, description: 'Task important status toggled successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  toggleImportant(
    @Param('id') id: string,
    @Body() dto: ToggleTaskImportantDto,
    @Request() req,
  ) {
    return this.tasksService.toggleImportant(id, dto.isImportant, req.user.userId, req.user.role);
  }

  @Patch(':id/my-day')
  @ApiOperation({ summary: 'Toggle task My Day status' })
  @ApiResponse({ status: 200, description: 'Task My Day status toggled successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  toggleMyDay(
    @Param('id') id: string,
    @Body() dto: ToggleTaskMyDayDto,
    @Request() req,
  ) {
    return this.tasksService.toggleMyDay(id, dto.isMyDay, req.user.userId, req.user.role);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Assign or unassign a task' })
  @ApiResponse({ status: 200, description: 'Task assigned successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  assignTask(
    @Param('id') id: string,
    @Body() dto: AssignTaskDto,
    @Request() req,
  ) {
    return this.tasksService.assignTask(id, dto.assigneeId, req.user.userId, req.user.role);
  }
}
