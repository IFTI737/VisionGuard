import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { DeviceService } from "@/modules/device/device.service";
import { CreateCredentialDto, CreateDeviceDto, UpdateDeviceDto } from "@/modules/device/dto/device.dto";
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("devices")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@RequirePermission("cameras.manage")
@Controller("sites/:siteId/devices")
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Get()
  async list(@SiteCtx() ctx: SiteContext) {
    return await this.deviceService.list(ctx.site.id);
  }

  @Post()
  async create(@SiteCtx() ctx: SiteContext, @Body() dto: CreateDeviceDto) {
    return await this.deviceService.create(ctx, dto);
  }

  @Post(":deviceId/pairing-code")
  async pairingCode(@SiteCtx() ctx: SiteContext, @Param("deviceId", ParseUUIDPipe) deviceId: string) {
    return await this.deviceService.newPairingCode(ctx.site.id, deviceId);
  }

  @Post(":deviceId/credentials")
  async createCredential(@SiteCtx() ctx: SiteContext, @Param("deviceId", ParseUUIDPipe) deviceId: string, @Body() dto: CreateCredentialDto) {
    return await this.deviceService.createCredential(ctx, deviceId, dto);
  }

  @Delete(":deviceId/credentials/:credentialId")
  @HttpCode(204)
  async revokeCredential(@SiteCtx() ctx: SiteContext, @Param("deviceId", ParseUUIDPipe) deviceId: string, @Param("credentialId", ParseUUIDPipe) credentialId: string) {
    await this.deviceService.revokeCredential(ctx, deviceId, credentialId);
  }

  @Patch(":deviceId")
  async update(@SiteCtx() ctx: SiteContext, @Param("deviceId", ParseUUIDPipe) deviceId: string, @Body() dto: UpdateDeviceDto) {
    return await this.deviceService.update(ctx, deviceId, dto);
  }

  @Delete(":deviceId")
  @HttpCode(204)
  async remove(@SiteCtx() ctx: SiteContext, @Param("deviceId", ParseUUIDPipe) deviceId: string) {
    await this.deviceService.remove(ctx, deviceId);
  }
}
