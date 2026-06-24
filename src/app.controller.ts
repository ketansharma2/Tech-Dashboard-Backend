import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Unauthenticated liveness probe — used by the Docker/compose healthcheck and
  // any external monitor. Marked @Public() so the global JwtAuthGuard skips it.
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime() };
  }
}
