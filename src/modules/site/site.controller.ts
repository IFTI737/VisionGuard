import { CheckPlanLimit, CurrentUser, RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, PlanLimitGuard, SiteMemberGuard } from "@/common/guard";
import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { AreaService } from "@/modules/site/area.service";
import {
  AcceptInviteDto, CallListDto, CreateAreaDto, CreateContactDto, CreateSiteDto, InviteMemberDto,
  NotifyPrefsDto, PauseSiteDto, TransferOwnershipDto, UpdateAreaDto, UpdateMemberDto, UpdateSiteDto,
} from "@/modules/site/dto/site.dto";
import { MemberService } from "@/modules/site/member.service";
import { SiteService } from "@/modules/site/site.service";
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

/** Routes that need a login but no site yet. */
@ApiTags("sites")
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller()
export class OnboardingController {
  constructor(
    private readonly siteService: SiteService,
    private readonly memberService: MemberService,
  ) {}

  @Post("onboarding")
  async onboard(@CurrentUser() user: AuthUser, @Body() dto: CreateSiteDto) {
    return await this.siteService.onboard(user.id, dto);
  }

  @Get("me/sites")
  async mySites(@CurrentUser() user: AuthUser) {
    return await this.siteService.listMine(user.id);
  }

  @Post("invites/accept")
  @HttpCode(200)
  async acceptInvite(@CurrentUser() user: AuthUser, @Body() dto: AcceptInviteDto) {
    return await this.memberService.acceptInvite(user.id, dto.token);
  }
}

/** Everything under /v1/sites/:siteId passes JwtGuard -> SiteMemberGuard -> PermissionGuard. */
@ApiTags("sites")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard, PlanLimitGuard)
@Controller("sites/:siteId")
export class SiteController {
  constructor(
    private readonly siteService: SiteService,
    private readonly memberService: MemberService,
    private readonly areaService: AreaService,
  ) {}

  @Get()
  getSite(@SiteCtx() ctx: SiteContext) {
    return this.siteService.getOne(ctx);
  }

  @Patch()
  @RequirePermission("site.manage")
  async updateSite(@SiteCtx() ctx: SiteContext, @Body() dto: UpdateSiteDto) {
    return await this.siteService.update(ctx, dto);
  }

  @Delete()
  @HttpCode(202)
  @RequirePermission("site.manage")
  async deleteSite(@SiteCtx() ctx: SiteContext) {
    await this.siteService.remove(ctx);
    return { message: "Site deleted. It can be restored by support for 30 days." };
  }

  @Post("pause")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async pause(@SiteCtx() ctx: SiteContext, @Body() dto: PauseSiteDto) {
    return await this.siteService.pause(ctx, dto.minutes);
  }

  @Post("resume")
  @HttpCode(200)
  @RequirePermission("incidents.manage")
  async resume(@SiteCtx() ctx: SiteContext) {
    return await this.siteService.resume(ctx);
  }

  // ---------------- members ----------------

  @Get("members")
  @RequirePermission("members.manage")
  async listMembers(@SiteCtx() ctx: SiteContext) {
    return await this.memberService.list(ctx.site.id);
  }

  @Get("members/me")
  myMembership(@SiteCtx() ctx: SiteContext) {
    return { ...ctx.member, permissions: ctx.permissions, areaIds: ctx.areaIds };
  }

  @Post("members/invite")
  @RequirePermission("members.manage")
  @CheckPlanLimit("members")
  async invite(@SiteCtx() ctx: SiteContext, @Body() dto: InviteMemberDto) {
    return await this.memberService.invite(ctx, dto);
  }

  @Post("members/contacts")
  @RequirePermission("members.manage")
  async addContact(@SiteCtx() ctx: SiteContext, @Body() dto: CreateContactDto) {
    return await this.memberService.addContact(ctx, dto);
  }

  @Put("members/call-list")
  @RequirePermission("members.manage")
  async setCallList(@SiteCtx() ctx: SiteContext, @Body() dto: CallListDto) {
    return await this.memberService.setCallList(ctx, dto.memberIds);
  }

  @Patch("members/me/notify-prefs")
  async notifyPrefs(@SiteCtx() ctx: SiteContext, @Body() dto: NotifyPrefsDto) {
    return await this.memberService.updateNotifyPrefs(ctx, dto);
  }

  @Post("members/transfer-ownership")
  @HttpCode(200)
  @RequirePermission("site.manage")
  async transferOwnership(@SiteCtx() ctx: SiteContext, @Body() dto: TransferOwnershipDto) {
    return await this.memberService.transferOwnership(ctx, dto.memberId);
  }

  @Patch("members/:memberId")
  @RequirePermission("members.manage")
  async updateMember(@SiteCtx() ctx: SiteContext, @Param("memberId", ParseUUIDPipe) memberId: string, @Body() dto: UpdateMemberDto) {
    return await this.memberService.update(ctx, memberId, dto);
  }

  @Delete("members/:memberId")
  @HttpCode(204)
  @RequirePermission("members.manage")
  async removeMember(@SiteCtx() ctx: SiteContext, @Param("memberId", ParseUUIDPipe) memberId: string) {
    await this.memberService.remove(ctx, memberId);
  }

  // ---------------- areas ----------------

  @Get("areas")
  async listAreas(@SiteCtx() ctx: SiteContext) {
    return await this.areaService.list(ctx);
  }

  @Post("areas")
  @RequirePermission("cameras.manage")
  async createArea(@SiteCtx() ctx: SiteContext, @Body() dto: CreateAreaDto) {
    return await this.areaService.create(ctx, dto);
  }

  @Patch("areas/:areaId")
  @RequirePermission("cameras.manage")
  async updateArea(@SiteCtx() ctx: SiteContext, @Param("areaId", ParseUUIDPipe) areaId: string, @Body() dto: UpdateAreaDto) {
    return await this.areaService.update(ctx, areaId, dto);
  }

  @Delete("areas/:areaId")
  @HttpCode(204)
  @RequirePermission("cameras.manage")
  async deleteArea(@SiteCtx() ctx: SiteContext, @Param("areaId", ParseUUIDPipe) areaId: string) {
    await this.areaService.remove(ctx, areaId);
  }
}
