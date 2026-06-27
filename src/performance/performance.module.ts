import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceScopeService } from './services/performance-scope.service';
import { PerformanceQueryService } from './services/performance-query.service';
import { PerformanceTargetService } from './services/performance-target.service';

@Module({
  controllers: [PerformanceController],
  providers: [
    PerformanceScopeService,
    PerformanceQueryService,
    PerformanceTargetService,
  ],
})
export class PerformanceModule {}
