import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AssistantQueryService } from './services/assistant-query.service';
import { AssistantActionService } from './services/assistant-action.service';
import { AssistantQueryDto } from './dto/assistant-query.dto';
import { AssistantActionDto } from './dto/assistant-action.dto';
import { DynamicPermissionGuard } from '../authz/permission.guard';
import {
  RequirePermissions,
  RequireAnyPermission,
} from '../authz/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

type Actor = { userId: string; role: Role };

@ApiTags('assistants')
@ApiBearerAuth()
@Controller('assistants')
@UseGuards(DynamicPermissionGuard)
export class AssistantsController {
  constructor(
    private readonly assistantQueryService: AssistantQueryService,
    private readonly assistantActionService: AssistantActionService,
  ) {}

  @Post('query')
  @RequirePermissions('assistant.view')
  query(@Body() dto: AssistantQueryDto, @CurrentUser() user: Actor) {
    return this.assistantQueryService.query(dto, user.userId, user.role);
  }

  @Post('action')
  @RequireAnyPermission('assistant.create', 'assistant.edit', 'assistant.delete', 'assistant.assign')
  executeAction(@Body() dto: AssistantActionDto, @CurrentUser() user: Actor) {
    return this.assistantActionService.execute(dto, user.userId, user.role);
  }
}
