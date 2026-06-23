import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';
import { DynamicPermissionGuard } from '../authz/permission.guard';
import { RequirePermissions } from '../authz/permissions.decorator';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(DynamicPermissionGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Post('query')
  @RequirePermissions('audit.view')
  query(@Body() dto: AuditQueryDto) {
    return this.auditService.query(dto);
  }

  @Get(':id')
  @RequirePermissions('audit.view')
  getOne(@Param('id') id: string) {
    return this.auditService.getById(id);
  }
}
