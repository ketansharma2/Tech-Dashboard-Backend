import { IsString, IsOptional, IsBoolean, IsEnum, IsArray, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority } from './create-task.dto';

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ description: 'Task title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Task description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isImportant?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMyDay?: boolean;

  @ApiPropertyOptional({ description: 'Due date in ISO format (null to remove)' })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiPropertyOptional({ description: 'Due time (HH:mm format, null to remove)' })
  @IsOptional()
  @IsString()
  dueTime?: string | null;

  @ApiPropertyOptional({ description: 'Assignee user ID (null to unassign)' })
  @IsOptional()
  @IsString()
  assigneeId?: string | null;

  @ApiPropertyOptional({ description: 'Reminder date-time in ISO format (null to remove)' })
  @IsOptional()
  @IsDateString()
  reminderAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMeeting?: boolean;

  @ApiPropertyOptional({ description: 'Meeting URL' })
  @IsOptional()
  @IsString()
  meetingUrl?: string;

  @ApiPropertyOptional({ description: 'Meeting start time (HH:mm format)' })
  @IsOptional()
  @IsString()
  meetingStartTime?: string;

  @ApiPropertyOptional({ description: 'Meeting end time (HH:mm format)' })
  @IsOptional()
  @IsString()
  meetingEndTime?: string;

  @ApiPropertyOptional({ description: 'Task tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
