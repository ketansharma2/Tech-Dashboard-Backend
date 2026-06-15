import { IsString, IsOptional, IsArray, IsObject, IsEnum, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TaskActionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  COMPLETE = 'COMPLETE',
  UNCOMPLETE = 'UNCOMPLETE',
  TOGGLE_IMPORTANT = 'TOGGLE_IMPORTANT',
  TOGGLE_MY_DAY = 'TOGGLE_MY_DAY',
  ASSIGN = 'ASSIGN',
  UNASSIGN = 'UNASSIGN',
  CHANGE_PRIORITY = 'CHANGE_PRIORITY',
  CHANGE_STATUS = 'CHANGE_STATUS',
  CHANGE_DUE_DATE = 'CHANGE_DUE_DATE',
  DUPLICATE = 'DUPLICATE',
  ARCHIVE = 'ARCHIVE',
  RESTORE = 'RESTORE',
  BULK_UPDATE = 'BULK_UPDATE',
  BULK_DELETE = 'BULK_DELETE',
  BULK_COMPLETE = 'BULK_COMPLETE',
  BULK_ASSIGN = 'BULK_ASSIGN',
  ADD_STEP = 'ADD_STEP',
  UPDATE_STEP = 'UPDATE_STEP',
  DELETE_STEP = 'DELETE_STEP',
  TOGGLE_STEP = 'TOGGLE_STEP',
  ADD_COMMENT = 'ADD_COMMENT',
  UPDATE_COMMENT = 'UPDATE_COMMENT',
  DELETE_COMMENT = 'DELETE_COMMENT',
}

export class TaskActionDto {
  @ApiProperty({ 
    enum: TaskActionType, 
    description: 'The action to perform on the task(s)',
    example: 'CREATE'
  })
  @IsEnum(TaskActionType)
  action: TaskActionType;

  @ApiPropertyOptional({ 
    description: 'Single task ID for single-task operations',
    example: 'clx123abc'
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => !o.taskIds || o.taskIds.length === 0)
  taskId?: string;

  @ApiPropertyOptional({ 
    description: 'Multiple task IDs for bulk operations',
    example: ['clx123abc', 'clx456def']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  taskIds?: string[];

  @ApiPropertyOptional({ 
    description: 'Action-specific payload data',
    example: { title: 'New Task', priority: 'HIGH' }
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export interface TaskActionResult {
  success: boolean;
  action: TaskActionType;
  data?: any;
  affected?: number;
  message?: string;
}

export interface TaskActionContext {
  userId: string;
  userRole: string;
  action: TaskActionType;
  taskId?: string;
  taskIds?: string[];
  payload?: Record<string, any>;
}
