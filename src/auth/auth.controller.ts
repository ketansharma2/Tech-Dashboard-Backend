import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
} from '@nestjs/common';
import { AuthService } from './auth.service';
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
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @UseGuards(JwtRefreshAuthGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(
    @CurrentUser() user: any,
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.refreshTokens(user.id, dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: any) {
    return this.authService.logout(user.id);
  }

  @Get('me')
  async getProfile(@CurrentUser() user: any) {
    return this.authService.validateUser(user.id);
  }
}
