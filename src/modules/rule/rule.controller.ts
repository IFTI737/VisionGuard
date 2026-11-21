import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { CreateRuleDto, MuteDto, UpdateModelAssignmentDto, UpdateRuleDto } from "@/modules/rule/dto/rule.dto";
import { RuleService } from "@/modules/rule/rule.service";
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("rules")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@Controller("sites/:siteId")
export class RuleController {
  constructor(private readonly ruleService: RuleService) {}

  @Get("rules")
  async list(@SiteCtx() ctx: SiteContext, @Query("zoneId") zoneId?: string, @Query("cameraId") cameraId?: string) {
    return await this.ruleService.list(ctx, { zoneId, cameraId });
  }

  @Post("zones/:zoneId/rules")
  @RequirePermission("rules.manage")
  async create(@SiteCtx() ctx: SiteContext, @Param("zoneId", ParseUUIDPipe) zoneId: string, @Body() dto: CreateRuleDto) {
    return await this.ruleService.createForZone(ctx, zoneId, dto);
  }

  @Get("rules/:ruleId")
  async getOne(@SiteCtx() ctx: SiteContext, @Param("ruleId", ParseUUIDPipe) ruleId: string) {
    return await this.ruleService.getOne(ctx, ruleId);
  }

  @Patch("rules/:ruleId")
  @RequirePermission("rules.manage")
  async update(@SiteCtx() ctx: SiteContext, @Param("ruleId", ParseUUIDPipe) ruleId: string, @Body() dto: UpdateRuleDto) {
    return await this.ruleService.update(ctx, ruleId, dto);
  }

  @Delete("rules/:ruleId")
  @HttpCode(204)
  @RequirePermission("rules.manage")
  async remove(@SiteCtx() ctx: SiteContext, @Param("ruleId", ParseUUIDPipe) ruleId: string) {
    await this.ruleService.remove(ctx, ruleId);
  }

  @Post("rules/:ruleId/mute")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async mute(@SiteCtx() ctx: SiteContext, @Param("ruleId", ParseUUIDPipe) ruleId: string, @Body() dto: MuteDto) {
    return await this.ruleService.mute(ctx, ruleId, dto.minutes);
  }

  @Get("cameras/:cameraId/models")
  @RequirePermission("cameras.manage")
  async assignments(@SiteCtx() ctx: SiteContext, @Param("cameraId", ParseUUIDPipe) cameraId: string) {
    return await this.ruleService.listAssignments(ctx, cameraId);
  }

  @Patch("model-assignments/:id")
  @RequirePermission("cameras.manage")
  async updateAssignment(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateModelAssignmentDto) {
    return await this.ruleService.updateAssignment(ctx, id, dto);
  }
}
