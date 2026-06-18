import { IsEnum, IsOptional, IsString, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

/**
 * All mutating operations on users flow through a single action endpoint.
 * Each action maps to a centrally-defined permission (see user-permission.policy).
 */
export enum UserActionType {
  CREATE_USER = 'CREATE_USER',
  UPDATE_USER = 'UPDATE_USER',
  DELETE_USER = 'DELETE_USER',
  ACTIVATE_USER = 'ACTIVATE_USER',
  DEACTIVATE_USER = 'DEACTIVATE_USER',
  RESET_PASSWORD = 'RESET_PASSWORD',
  ASSIGN_ROLE = 'ASSIGN_ROLE',
  ASSIGN_DEPARTMENT = 'ASSIGN_DEPARTMENT',
  ASSIGN_MANAGER = 'ASSIGN_MANAGER',
}

export class UserActionDto {
  @ApiProperty({ enum: UserActionType, description: 'The action to perform' })
  @IsEnum(UserActionType)
  action: UserActionType;

  @ApiPropertyOptional({
    description: 'Target user ID (required for every action except CREATE_USER)',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Action-specific payload (profile fields, role, departmentId, etc.)',
    example: { firstName: 'Jane', role: 'ASSOCIATE', department: 'TECH' },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export interface UserActionResult {
  success: boolean;
  action: UserActionType;
  data?: any;
  message?: string;
}

export interface UserActionContext {
  actorId: string;
  actorRole: Role;
  action: UserActionType;
  userId?: string;
  payload?: Record<string, any>;
}
