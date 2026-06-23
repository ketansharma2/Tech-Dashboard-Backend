import { Module } from '@nestjs/common';
import { AssistantsController } from './assistants.controller';
import { AssistantQueryService } from './services/assistant-query.service';
import { AssistantActionService } from './services/assistant-action.service';

@Module({
  controllers: [AssistantsController],
  providers: [AssistantQueryService, AssistantActionService],
})
export class AssistantsModule {}
