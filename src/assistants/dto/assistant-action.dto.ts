import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AssistantActionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  ACTIVATE = 'ACTIVATE',
  DEACTIVATE = 'DEACTIVATE',
  RESET_PASSWORD = 'RESET_PASSWORD',
  GRANT_PERMISSIONS = 'GRANT_PERMISSIONS',
  REVOKE_PERMISSIONS = 'REVOKE_PERMISSIONS',
  DELETE = 'DELETE',
}

export class AssistantActionDto {
  @ApiProperty({ enum: AssistantActionType })
  @IsEnum(AssistantActionType)
  action: AssistantActionType;

  @ApiPropertyOptional({ description: 'Target assistant user id (required except for CREATE)' })
  @IsOptional()
  @IsString()
  assistantId?: string;

  @ApiPropertyOptional({
    description: 'Payload, e.g. { firstName, email, password, permissionKeys: ["task.view"] }',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export interface AssistantActionResult {
  success: boolean;
  action: AssistantActionType;
  data?: any;
  message?: string;
}
