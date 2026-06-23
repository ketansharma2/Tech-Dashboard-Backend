import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum RoleActionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  CLONE = 'CLONE',
  ACTIVATE = 'ACTIVATE',
  DEACTIVATE = 'DEACTIVATE',
  ASSIGN_PERMISSIONS = 'ASSIGN_PERMISSIONS',
}

export class RoleActionDto {
  @ApiProperty({ enum: RoleActionType })
  @IsEnum(RoleActionType)
  action: RoleActionType;

  @ApiPropertyOptional({ description: 'Target role id (required for all actions except CREATE)' })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({
    description: 'Action payload, e.g. { name, description, permissionKeys: ["task.view"] }',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export interface RoleActionResult {
  success: boolean;
  action: RoleActionType;
  data?: any;
  message?: string;
}
