import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RoleQueryService } from './services/role-query.service';
import { RoleActionService } from './services/role-action.service';
import { RoleQueryDto } from './dto/role-query.dto';
import { RoleActionDto } from './dto/role-action.dto';
import { DynamicPermissionGuard } from '../authz/permission.guard';
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
@UseGuards(DynamicPermissionGuard)
export class RolesController {
  constructor(
    private readonly roleQueryService: RoleQueryService,
    private readonly roleActionService: RoleActionService,
  ) {}

  @Post('query')
  @RequirePermissions('role.view')
  query(@Body() dto: RoleQueryDto) {
    return this.roleQueryService.query(dto);
  }

  @Post('action')
  // Coarse gate; the precise per-action permission is enforced in the service.
  @RequireAnyPermission('role.create', 'role.edit', 'role.delete', 'role.assign')
  executeAction(@Body() dto: RoleActionDto, @CurrentUser() user: { userId: string }) {
    return this.roleActionService.execute(dto, user.userId);
  }
}
