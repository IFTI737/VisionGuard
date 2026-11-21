import { CurrentUser } from "@/common/decorators";
import { JwtGuard, RefreshJwtGuard } from "@/common/guard";
import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { appConfig } from "@/config/app.config";
import { AuthService } from "@/modules/auth/auth.service";
import {
  ChangePasswordDto, ForgotPasswordDto, LoginDto, PasswordConfirmDto, RefreshDto, RegisterDto,
  ResendCodeDto, ResetPasswordDto, TwoFactorVerifyDto, VerifyEmailDto,
} from "@/modules/auth/dto/auth.dto";
import { REFRESH_COOKIE, refreshTokenFromRequest } from "@/modules/auth/strategies/refresh-jwt.strategy";
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";

const clientOf = (req: Request) => ({ userAgent: req.headers["user-agent"], ip: req.ip });
// 10 requests a minute per IP on the routes somebody could guess passwords or codes on
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle(STRICT)
  @Post("register")
  async register(@Body() dto: RegisterDto) {
    return await this.authService.register(dto);
  }

  @Throttle(STRICT)
  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return await this.authService.verifyEmail(dto);
  }

  @Throttle(STRICT)
  @Post("resend-code")
  @HttpCode(202)
  async resendCode(@Body() dto: ResendCodeDto) {
    return await this.authService.resendCode(dto);
  }

  @Throttle(STRICT)
  @Post("login")
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto, clientOf(req));
    if ("refreshToken" in result) this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Throttle(STRICT)
  @Post("2fa/verify")
  @HttpCode(200)
  async verifyTwoFactor(@Body() dto: TwoFactorVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyTwoFactor(dto, clientOf(req));
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @UseGuards(RefreshJwtGuard)
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Body() _dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refresh(req.user as any, clientOf(req));
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Post("logout")
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Body() _dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(user, refreshTokenFromRequest(req));
    res.clearCookie(REFRESH_COOKIE, { path: "/v1/auth" });
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Post("logout-all")
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.authService.logoutAll(user);
    res.clearCookie(REFRESH_COOKIE, { path: "/v1/auth" });
  }

  @Throttle(STRICT)
  @Post("password/forgot")
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return await this.authService.forgotPassword(dto);
  }

  @Throttle(STRICT)
  @Post("password/reset")
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return await this.authService.resetPassword(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Post("password/change")
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return await this.authService.changePassword(user, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Post("2fa/enable")
  @HttpCode(200)
  async enableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto) {
    return await this.authService.setTwoFactor(user, dto.password, true);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Post("2fa/disable")
  @HttpCode(200)
  async disableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: PasswordConfirmDto) {
    return await this.authService.setTwoFactor(user, dto.password, false);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Get("sessions")
  async sessions(@CurrentUser() user: AuthUser) {
    return await this.authService.listSessions(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtGuard)
  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeSession(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.authService.revokeSession(user.id, id);
  }

  // httpOnly: JavaScript in the browser cannot read it. Postman keeps it in its cookie jar.
  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: appConfig.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/v1/auth",
      maxAge: appConfig.env.JWT_REFRESH_TTL_DAYS * 86400 * 1000,
    });
  }
}
