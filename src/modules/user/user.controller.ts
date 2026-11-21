import { CurrentUser } from "@/common/decorators";
import { JwtGuard } from "@/common/guard";
import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { UpdateMeDto, WebPushEndpointDto } from "@/modules/user/dto/user.dto";
import { UserService } from "@/modules/user/user.service";
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("me")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller("me")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async getMe(@CurrentUser() user: AuthUser) {
    return await this.userService.getMe(user.id);
  }

  @Patch()
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return await this.userService.updateMe(user.id, dto);
  }

  @Get("endpoints")
  async listEndpoints(@CurrentUser() user: AuthUser) {
    return await this.userService.listEndpoints(user.id);
  }

  @Post("endpoints/webpush")
  async addWebPush(@CurrentUser() user: AuthUser, @Body() dto: WebPushEndpointDto) {
    return await this.userService.addWebPush(user.id, dto);
  }

  @Delete("endpoints/:id")
  @HttpCode(204)
  async removeEndpoint(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.userService.removeEndpoint(user.id, id);
  }

  @Post("telegram/link")
  async telegramLink(@CurrentUser() user: AuthUser) {
    return await this.userService.createTelegramLink(user.id);
  }
}
