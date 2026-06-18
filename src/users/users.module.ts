import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UserQueryService } from './services/user-query.service';
import { UserActionService } from './services/user-action.service';

/**
 * User Management module. PrismaService (PrismaModule) and AuditService
 * (AuditModule) are global, so only the feature services are provided here.
 */
@Module({
  controllers: [UsersController],
  providers: [UserQueryService, UserActionService],
  exports: [UserQueryService],
})
export class UsersModule {}
