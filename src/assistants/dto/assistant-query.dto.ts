import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AssistantQueryDto {
  @ApiPropertyOptional({ description: 'Fetch a single assistant (detail / monitoring view)' })
  @IsOptional()
  @IsString()
  assistantId?: string;

  @ApiPropertyOptional({ description: 'SUPERADMIN only: scope to a specific principal' })
  @IsOptional()
  @IsString()
  principalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Include the assistant\'s performed-action timeline' })
  @IsOptional()
  @IsBoolean()
  includeActivity?: boolean;

  @ApiPropertyOptional({ description: 'Include login history' })
  @IsOptional()
  @IsBoolean()
  includeLoginHistory?: boolean;
}
