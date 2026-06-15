import { IsOptional, IsEnum, IsString, IsBoolean, IsInt, Min, IsArray, IsDateString } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority } from './create-task.dto';
import { TaskStatus } from './update-task.dto';

export class QueryTasksDto {
  @ApiPropertyOptional({ description: 'Search query for title, description, or tags' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: TaskPriority, isArray: true, description: 'Filter by priorities' })
  @IsOptional()
  @IsArray()
  @IsEnum(TaskPriority, { each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  priority?: TaskPriority[];

  @ApiPropertyOptional({ enum: TaskStatus, isArray: true, description: 'Filter by statuses' })
  @IsOptional()
  @IsArray()
  @IsEnum(TaskStatus, { each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  status?: TaskStatus[];

  @ApiPropertyOptional({ description: 'Filter by assignee ID' })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Filter by completion status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({ description: 'Filter by important status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isImportant?: boolean;

  @ApiPropertyOptional({ description: 'Filter by My Day status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isMyDay?: boolean;

  @ApiPropertyOptional({ description: 'Filter by meeting status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isMeeting?: boolean;

  @ApiPropertyOptional({ description: 'Filter tasks with due date from this date (ISO format)' })
  @IsOptional()
  @IsDateString()
  dueDateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter tasks with due date until this date (ISO format)' })
  @IsOptional()
  @IsDateString()
  dueDateTo?: string;

  @ApiPropertyOptional({ description: 'Filter by tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => Array.isArray(value) ? value : [value])
  tags?: string[];

  @ApiPropertyOptional({ enum: ['dueDate', 'priority', 'createdAt', 'title'], default: 'createdAt' })
  @IsOptional()
  @IsEnum(['dueDate', 'priority', 'createdAt', 'title'])
  sortBy?: 'dueDate' | 'priority' | 'createdAt' | 'title';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 50, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
