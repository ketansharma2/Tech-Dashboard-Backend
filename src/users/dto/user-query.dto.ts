import {
  IsOptional,
  IsString,
  IsArray,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role, Department } from '@prisma/client';

export type UserSortBy = 'createdAt' | 'firstName' | 'lastName' | 'role' | 'department';
export type SortOrder = 'asc' | 'desc';

/**
 * Single query DTO for the user directory. Drives the dynamic Prisma `where`
 * in UserQueryService. Role-based scoping is applied on top of these filters
 * automatically — callers cannot widen their own visibility through filters.
 */
export class UserQueryDto {
  @ApiPropertyOptional({ description: 'Fetch a single user by id (detail view)' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Free-text search over name and email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: Role, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  role?: Role[];

  @ApiPropertyOptional({ enum: Department })
  @IsOptional()
  @IsEnum(Department)
  department?: Department;

  @ApiPropertyOptional({ description: 'Filter by manager (user id)' })
  @IsOptional()
  @IsString()
  managerId?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: ['createdAt', 'firstName', 'lastName', 'role', 'department'], default: 'createdAt' })
  @IsOptional()
  @IsEnum(['createdAt', 'firstName', 'lastName', 'role', 'department'])
  sortBy?: UserSortBy;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: SortOrder;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Include summary stats + filter facets in the response' })
  @IsOptional()
  @IsBoolean()
  includeStats?: boolean;

  @ApiPropertyOptional({ description: 'Include the audit activity timeline (single-user view)' })
  @IsOptional()
  @IsBoolean()
  includeActivity?: boolean;
}
