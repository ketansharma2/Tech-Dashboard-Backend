import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Role as PrismaRole } from '@prisma/client';
import { UserQueryService } from './services/user-query.service';
import { UserActionService } from './services/user-action.service';
import { UserQueryDto } from './dto/user-query.dto';
import { UserActionDto } from './dto/user-action.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../auth/enums/role.enum';
import { UserPermission } from '../auth/permissions/user-permission.policy';

type Actor = { userId: string; email: string; role: PrismaRole };

/**
 * User Management API — exactly two endpoints, both behind JWT (global guard),
 * role checks (RolesGuard + @Roles) and permission checks (PermissionGuard +
 * @RequirePermissions). ASSOCIATE is blocked here; finer rules live in the
 * services via the central permission policy. The controller stays thin.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(RolesGuard, PermissionGuard)
@Roles(Role.SUPERADMIN, Role.ADMIN, Role.HOD, Role.LEAD)
@RequirePermissions(UserPermission.VIEW)
export class UsersController {
  constructor(
    private readonly userQueryService: UserQueryService,
    private readonly userActionService: UserActionService,
  ) {}

  @Post('query')
  @ApiOperation({ summary: 'Query users (role-scoped, filtered, paginated)' })
  @ApiResponse({ status: 201, description: 'Users retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  queryUsers(@Body() dto: UserQueryDto, @CurrentUser() user: Actor) {
    return this.userQueryService.query(dto, user.userId, user.role);
  }

  @Post('action')
  @ApiOperation({ summary: 'Execute a user-management action (RBAC-enforced)' })
  @ApiResponse({ status: 201, description: 'Action executed successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  executeAction(@Body() dto: UserActionDto, @CurrentUser() user: Actor) {
    return this.userActionService.execute(dto, user.userId, user.role);
  }
}
