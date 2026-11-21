import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { MetricsService } from "@/modules/ingestion/metrics.service";
import { SiteAccessService } from "@/modules/site/site-access.service";
import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@ApiTags("live state and analytics")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@Controller("sites/:siteId")
export class LiveController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly metrics: MetricsService,
    @InjectRepository(Zone) private readonly zoneRepository: Repository<Zone>,
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
  ) {}

  /** What every zone looks like right now: counts per class and the state of each rule. */
  @Get("live")
  @RequirePermission("live.view")
  async live(@SiteCtx() ctx: SiteContext) {
    const states = await this.ingestion.liveState(ctx.site.id);
    if (ctx.areaIds === null) return states;
    const allowed = await this.allowedZoneIds(ctx);
    return states.filter((s) => allowed.has(s.zoneId));
  }

  @Get("zones/:zoneId/metrics")
  @RequirePermission("reports.view")
  async zoneMetrics(
    @SiteCtx() ctx: SiteContext, @Param("zoneId", ParseUUIDPipe) zoneId: string,
    @Query("key") key: string, @Query("from") from?: string, @Query("to") to?: string, @Query("step") step?: string,
  ) {
    await this.assertZone(ctx, zoneId);
    if (!key) throw new BadRequestException("key is required, e.g. key=count.cow");
    const toDate = to ? new Date(to) : new Date(Date.now() + 60_000);
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 6 * 3600_000);
    if (isNaN(+fromDate) || isNaN(+toDate)) throw new BadRequestException("from and to must be dates");
    return await this.metrics.points(zoneId, key, fromDate, toDate, step === "hour" ? "hour" : "minute");
  }

  @Get("zones/:zoneId/baseline")
  @RequirePermission("reports.view")
  async baseline(@SiteCtx() ctx: SiteContext, @Param("zoneId", ParseUUIDPipe) zoneId: string, @Query("key") key: string) {
    await this.assertZone(ctx, zoneId);
    if (!key) throw new BadRequestException("key is required, e.g. key=count.person");
    return await this.metrics.baselineCurve(zoneId, key);
  }

  private async assertZone(ctx: SiteContext, zoneId: string) {
    const zone = await this.zoneRepository.findOne({ where: { id: zoneId, siteId: ctx.site.id } });
    if (!zone) throw new NotFoundException("Zone not found");
    const camera = await this.cameraRepository.findOneOrFail({ where: { id: zone.cameraId } });
    SiteAccessService.assertArea(ctx, camera.areaId);
  }

  private async allowedZoneIds(ctx: SiteContext) {
    const cameras = await this.cameraRepository.find({ where: { siteId: ctx.site.id } });
    const cameraIds = cameras.filter((c) => ctx.areaIds!.includes(c.areaId)).map((c) => c.id);
    const zones = await this.zoneRepository.find({ where: { siteId: ctx.site.id } });
    return new Set(zones.filter((z) => cameraIds.includes(z.cameraId)).map((z) => z.id));
  }
}
