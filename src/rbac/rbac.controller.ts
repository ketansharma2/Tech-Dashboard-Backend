import {
  Controller,
  Get,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { canManageRole } from '../auth/utils/role.utils';

/**
 * RBAC Controller
 * Demonstrates role-based access control with various protected endpoints
 */
@Controller('rbac')
export class RbacController {
  /**
   * Accessible by all authenticated users
   */
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return {
      message: 'Your profile',
      user: req.user,
      access: 'All authenticated users',
    };
  }

  /**
   * Accessible by ASSOCIATE and above
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ASSOCIATE, Role.LEAD, Role.HOD, Role.ADMIN, Role.SUPERADMIN)
  @Get('associate')
  getAssociateContent(@Request() req) {
    return {
      message: 'Associate level content',
      user: req.user,
      access: 'ASSOCIATE and above',
    };
  }

  /**
   * Accessible by LEAD and above
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.LEAD, Role.HOD, Role.ADMIN, Role.SUPERADMIN)
  @Get('lead')
  getLeadContent(@Request() req) {
    return {
      message: 'Lead level content',
      user: req.user,
      access: 'LEAD and above',
    };
  }

  /**
   * Accessible by HOD and above
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.HOD, Role.ADMIN, Role.SUPERADMIN)
  @Get('hod')
  getHodContent(@Request() req) {
    return {
      message: 'HOD level content',
      user: req.user,
      access: 'HOD and above',
    };
  }

  /**
   * Accessible by ADMIN and above
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @Get('admin')
  getAdminContent(@Request() req) {
    return {
      message: 'Admin level content',
      user: req.user,
      access: 'ADMIN and above',
    };
  }

  /**
   * Accessible only by SUPERADMIN
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPERADMIN)
  @Get('superadmin')
  getSuperadminContent(@Request() req) {
    return {
      message: 'Superadmin level content',
      user: req.user,
      access: 'SUPERADMIN only',
    };
  }

  /**
   * Demo endpoint showing role management capabilities
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.LEAD, Role.HOD, Role.ADMIN, Role.SUPERADMIN)
  @Get('manage-users')
  manageUsers(@Request() req) {
    const currentUser = req.user;
    const manageableRoles = canManageRole(currentUser.role, Role.ASSOCIATE)
      ? ['ASSOCIATE']
      : canManageRole(currentUser.role, Role.LEAD)
      ? ['LEAD', 'ASSOCIATE']
      : canManageRole(currentUser.role, Role.HOD)
      ? ['HOD', 'LEAD', 'ASSOCIATE']
      : canManageRole(currentUser.role, Role.ADMIN)
      ? ['ADMIN', 'HOD', 'LEAD', 'ASSOCIATE']
      : ['SUPERADMIN', 'ADMIN', 'HOD', 'LEAD', 'ASSOCIATE'];

    return {
      message: 'User management capabilities',
      currentUser: currentUser.role,
      canManage: manageableRoles,
      description: `As ${currentUser.role}, you can manage users with roles: ${manageableRoles.join(', ')}`,
    };
  }

  /**
   * Demo endpoint showing self-access only for ASSOCIATE
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ASSOCIATE)
  @Get('self-only')
  getSelfOnlyContent(@Request() req) {
    return {
      message: 'Self-access content',
      user: req.user,
      access: 'ASSOCIATE self-access only',
      description: 'As an ASSOCIATE, you can only access your own data',
    };
  }
}
