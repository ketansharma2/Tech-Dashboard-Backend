import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';

/**
 * Read-only permission catalog. Any authenticated user may read it (it is
 * non-sensitive metadata used to render permission pickers); the global
 * JwtAuthGuard already enforces authentication.
 */
@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  getCatalog() {
    return this.permissionsService.getCatalog();
  }
}
