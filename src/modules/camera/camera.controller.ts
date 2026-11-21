import { CheckPlanLimit, RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, PlanLimitGuard, SiteMemberGuard } from "@/common/guard";
import { CameraService } from "@/modules/camera/camera.service";
import { CreateCameraDto, CreateZoneDto, QuickstartZoneDto, UpdateCameraDto, UpdateZoneDto } from "@/modules/camera/dto/camera.dto";
import { ZoneService } from "@/modules/camera/zone.service";
import { MuteDto } from "@/modules/rule/dto/rule.dto";
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("cameras and zones")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard, PlanLimitGuard)
@Controller("sites/:siteId")
export class CameraController {
  constructor(
    private readonly cameraService: CameraService,
    private readonly zoneService: ZoneService,
  ) {}

  @Get("cameras")
  async list(@SiteCtx() ctx: SiteContext, @Query("areaId") areaId?: string, @Query("status") status?: string) {
    return await this.cameraService.list(ctx, { areaId, status });
  }

  @Post("cameras")
  @RequirePermission("cameras.manage")
  @CheckPlanLimit("cameras")
  async create(@SiteCtx() ctx: SiteContext, @Body() dto: CreateCameraDto) {
    return await this.cameraService.create(ctx, dto);
  }

  @Get("cameras/:cameraId")
  async getOne(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string) {
    return await this.cameraService.getOne(ctx, cameraId);
  }

  @Patch("cameras/:cameraId")
  @RequirePermission("cameras.manage")
  async update(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string, @Body() dto: UpdateCameraDto) {
    return await this.cameraService.update(ctx, cameraId, dto);
  }

  @Delete("cameras/:cameraId")
  @HttpCode(204)
  @RequirePermission("cameras.manage")
  async remove(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string) {
    await this.cameraService.remove(ctx, cameraId);
  }

  // ---------------- zones ----------------

  @Get("cameras/:cameraId/zones")
  async zones(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string) {
    return await this.zoneService.list(ctx, cameraId);
  }

  @Post("cameras/:cameraId/zones")
  @RequirePermission("zones.manage")
  async createZone(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string, @Body() dto: CreateZoneDto) {
    return await this.zoneService.create(ctx, cameraId, dto);
  }

  @Post("cameras/:cameraId/zones/quickstart")
  @RequirePermission("zones.manage", "rules.manage")
  async quickstart(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string, @Body() dto: QuickstartZoneDto) {
    return await this.zoneService.quickstart(ctx, cameraId, dto);
  }

  @Patch("zones/:zoneId")
  @RequirePermission("zones.manage")
  async updateZone(@SiteCtx() ctx: SiteContext, @Param("zoneId", ParseUUIDPipe) zoneId: string, @Body() dto: UpdateZoneDto) {
    return await this.zoneService.update(ctx, zoneId, dto);
  }

  @Delete("zones/:zoneId")
  @HttpCode(204)
  @RequirePermission("zones.manage")
  async removeZone(@SiteCtx() ctx: SiteContext, @Param("zoneId", ParseUUIDPipe) zoneId: string) {
    await this.zoneService.remove(ctx, zoneId);
  }

  @Post("zones/:zoneId/mute")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async muteZone(@SiteCtx() ctx: SiteContext, @Param("zoneId", ParseUUIDPipe) zoneId: string, @Body() dto: MuteDto) {
    return await this.zoneService.mute(ctx, zoneId, dto.minutes);
  }
}
