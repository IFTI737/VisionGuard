import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { FalseAlarmDto, IncidentNoteDto, ListIncidentsDto, ResolveIncidentDto, ShareIncidentDto } from "@/modules/incident/dto/incident.dto";
import { IncidentService } from "@/modules/incident/incident.service";
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("incidents")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@Controller("sites/:siteId/incidents")
export class IncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  @Get()
  @RequirePermission("incidents.view")
  async list(@SiteCtx() ctx: SiteContext, @Query() query: ListIncidentsDto) {
    return await this.incidentService.list(ctx, query);
  }

  @Get(":id")
  @RequirePermission("incidents.view")
  async getOne(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    return await this.incidentService.getOne(ctx, id);
  }

  @Post(":id/acknowledge")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async acknowledge(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    return await this.incidentService.acknowledge(ctx, id);
  }

  @Post(":id/resolve")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async resolve(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ResolveIncidentDto) {
    return await this.incidentService.resolve(ctx, id, dto.note);
  }

  @Post(":id/false-alarm")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async falseAlarm(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: FalseAlarmDto) {
    return await this.incidentService.falseAlarm(ctx, id, dto);
  }

  @Post(":id/reopen")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async reopen(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    return await this.incidentService.reopen(ctx, id);
  }

  @Post(":id/notes")
  @RequirePermission("incidents.view")
  async note(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: IncidentNoteDto) {
    return await this.incidentService.addNote(ctx, id, dto.text);
  }

  @Post(":id/share")
  @RequirePermission("incidents.manage")
  async share(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ShareIncidentDto) {
    return await this.incidentService.share(ctx, id, dto.hours);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("site.manage")
  async remove(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    await this.incidentService.remove(ctx, id);
  }
}

/** Public: opened with a signed link, no login. Shows only the basics. */
@ApiTags("incidents")
@Controller("shared/incidents")
export class SharedIncidentController {
  constructor(private readonly incidentService: IncidentService) {}

  @Get(":token")
  async shared(@Param("token") token: string) {
    return await this.incidentService.shared(token);
  }
}
