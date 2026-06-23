import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
  Req,
} from '@nestjs/common';
import { AuthService, RequestContext } from './auth.service';

function requestContext(req: any): RequestContext {
  const forwarded = (req?.headers?.['x-forwarded-for'] as string) || '';
  return {
    ipAddress: forwarded.split(',')[0]?.trim() || req?.ip || null,
    userAgent: (req?.headers?.['user-agent'] as string) || null,
  };
}
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto, requestContext(req));
  }

  @Public()
  @UseGuards(JwtRefreshAuthGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(
    @CurrentUser() user: any,
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.refreshTokens(user.userId, dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: any, @Req() req: any) {
    return this.authService.logout(user.userId, requestContext(req));
  }

  @Get('me')
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getMe(user.userId);
  }

  @Get('permissions')
  async getPermissions(@CurrentUser() user: any) {
    return this.authService.getEffectivePermissions(user.userId);
  }
}
