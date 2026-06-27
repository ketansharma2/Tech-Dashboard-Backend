import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PerformanceActionType {
  SET_TARGET = 'SET_TARGET',
  RESET_TARGET = 'RESET_TARGET',
}

export class PerformanceActionDto {
  @ApiProperty({ enum: PerformanceActionType })
  @IsEnum(PerformanceActionType)
  action: PerformanceActionType;

  @ApiPropertyOptional({
    description:
      'Payload, e.g. { scope: "DEPARTMENT", department: "TECH", completionRate: 85, onTimeRate: 80, maxOverdue: 8, cycleTimeDays: 4 }',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export interface PerformanceActionResult {
  success: boolean;
  action: PerformanceActionType;
  data?: unknown;
  message?: string;
}
