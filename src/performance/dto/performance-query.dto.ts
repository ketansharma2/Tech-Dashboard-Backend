import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Department } from '@prisma/client';

export type PerfRange = '7d' | '30d' | '90d' | 'month' | 'quarter' | 'custom';

const RANGES: PerfRange[] = ['7d', '30d', '90d', 'month', 'quarter', 'custom'];

export class PerformanceQueryDto {
  @ApiPropertyOptional({ enum: ['team', 'member'], default: 'team' })
  @IsOptional()
  @IsEnum(['team', 'member'])
  view?: 'team' | 'member' = 'team';

  @ApiPropertyOptional({ description: 'Required when view=member' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ enum: RANGES, default: '30d' })
  @IsOptional()
  @IsEnum(RANGES)
  range?: PerfRange = '30d';

  @ApiPropertyOptional({ description: 'Custom range start (ISO) when range=custom' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Custom range end (ISO) when range=custom' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: Department, description: 'Admin/Superadmin department filter' })
  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @ApiPropertyOptional({ description: 'Member-table sort column', default: 'completionRate' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
