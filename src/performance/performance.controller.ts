import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PerformanceQueryService } from './services/performance-query.service';
import { PerformanceTargetService } from './services/performance-target.service';
import { PerformanceQueryDto } from './dto/performance-query.dto';
import { PerformanceActionDto } from './dto/performance-action.dto';
import { DynamicPermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

type Actor = { userId: string; role: Role };

@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(DynamicPermissionGuard)
export class PerformanceController {
  constructor(
    private readonly queryService: PerformanceQueryService,
    private readonly targetService: PerformanceTargetService,
  ) {}

  @Post('query')
  @RequirePermissions('performance.view')
  query(@Body() dto: PerformanceQueryDto, @CurrentUser() user: Actor) {
    return this.queryService.query(dto, user.userId, user.role);
  }

  @Get('targets')
  @RequirePermissions('performance.view')
  targets(@CurrentUser() user: Actor) {
    return this.targetService.list(user.userId, user.role);
  }

  @Post('action')
  @RequirePermissions('performance.manage_targets')
  action(@Body() dto: PerformanceActionDto, @CurrentUser() user: Actor) {
    return this.targetService.execute(dto, user.userId, user.role);
  }
}
