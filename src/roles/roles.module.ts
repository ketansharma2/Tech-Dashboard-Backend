import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RoleQueryService } from './services/role-query.service';
import { RoleActionService } from './services/role-action.service';

@Module({
  controllers: [RolesController],
  providers: [RoleQueryService, RoleActionService],
  exports: [RoleQueryService],
})
export class RolesModule {}
