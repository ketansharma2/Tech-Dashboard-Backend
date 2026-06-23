import { Module, Global } from '@nestjs/common';
import { PermissionResolverService } from './permission-resolver.service';
import { DynamicPermissionGuard } from './permission.guard';

/**
 * Authorization core. Global so the effective-permission resolver and the
 * dynamic permission guard are available to every feature module.
 */
@Global()
@Module({
  providers: [PermissionResolverService, DynamicPermissionGuard],
  exports: [PermissionResolverService, DynamicPermissionGuard],
})
export class AuthzModule {}
