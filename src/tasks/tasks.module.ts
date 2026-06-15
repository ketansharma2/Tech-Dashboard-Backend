import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TaskActionService } from './services/task-action.service';
import { TaskQueryService } from './services/task-query.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TasksController],
  providers: [TaskActionService, TaskQueryService],
  exports: [TaskActionService, TaskQueryService],
})
export class TasksModule {}
