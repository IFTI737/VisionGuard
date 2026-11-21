import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { appConfig } from "@/config/app.config";
import { AlertService } from "@/modules/alert/alert.service";
import { CallService } from "@/modules/alert/call.service";
import { AckTokenDto, CreateAlertDto, EscalationPolicyDto, ListAlertsDto, MockVoiceDto } from "@/modules/alert/dto/alert.dto";
import { PolicyService } from "@/modules/alert/policy.service";
import { UserService } from "@/modules/user/user.service";
import {
  Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res,
  UnauthorizedException, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { Response } from "express";

@ApiTags("alerts")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@Controller("sites/:siteId")
export class AlertController {
  constructor(
    private readonly alertService: AlertService,
    private readonly policyService: PolicyService,
  ) {}

  @Get("alerts")
  @RequirePermission("alerts.receive")
  async list(@SiteCtx() ctx: SiteContext, @Query() query: ListAlertsDto) {
    return await this.alertService.list(ctx.site.id, query);
  }

  @Post("alerts")
  @RequirePermission("alerts.send")
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Same key = same alert (safe to retry)" })
  async create(@SiteCtx() ctx: SiteContext, @Body() dto: CreateAlertDto, @Headers("idempotency-key") key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const result = await this.alertService.createManual(ctx, dto, key);
    res.status(result.created ? 201 : 200); // 200 = this key was already used; here is that alert
    return result;
  }

  @Post("alerts/test")
  @RequirePermission("members.manage")
  async test(@SiteCtx() ctx: SiteContext) {
    return await this.alertService.createTest(ctx);
  }

  @Get("alerts/:id")
  @RequirePermission("alerts.receive")
  async getOne(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    return await this.alertService.getOne(ctx.site.id, id);
  }

  @Post("alerts/:id/acknowledge")
  @HttpCode(200)
  @RequirePermission("alerts.receive")
  async acknowledge(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    await this.alertService.findOrFail(ctx.site.id, id);
    return await this.alertService.acknowledge(id, ctx.member.id, "app");
  }

  @Post("alerts/:id/cancel")
  @HttpCode(200)
  @RequirePermission("alerts.send")
  async cancel(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    return await this.alertService.cancel(ctx, id);
  }

  // ---------------- escalation policies ----------------

  @Get("escalation-policies")
  @RequirePermission("members.manage")
  async policies(@SiteCtx() ctx: SiteContext) {
    return await this.policyService.list(ctx.site.id);
  }

  @Post("escalation-policies")
  @RequirePermission("members.manage")
  async createPolicy(@SiteCtx() ctx: SiteContext, @Body() dto: EscalationPolicyDto) {
    return await this.policyService.create(ctx.site.id, dto);
  }

  @Put("escalation-policies/:id")
  @RequirePermission("members.manage")
  async replacePolicy(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: EscalationPolicyDto) {
    return await this.policyService.replace(ctx.site.id, id, dto);
  }

  @Delete("escalation-policies/:id")
  @HttpCode(204)
  @RequirePermission("members.manage")
  async removePolicy(@SiteCtx() ctx: SiteContext, @Param("id", ParseUUIDPipe) id: string) {
    await this.policyService.remove(ctx.site.id, id);
  }
}

/** Routes called from outside a login: an acknowledge link, Telegram, the voice provider. */
@ApiTags("webhooks")
@Controller()
export class AlertWebhookController {
  constructor(
    private readonly alertService: AlertService,
    private readonly callService: CallService,
    private readonly userService: UserService,
  ) {}

  /** The one-time token in the notification proves who is acknowledging. */
  @Post("alerts/ack")
  @HttpCode(200)
  async ackByToken(@Body() dto: AckTokenDto) {
    return await this.alertService.acknowledgeByToken(dto.token, "webpush");
  }

  /** Telegram calls this for every message and button press sent to our bot. */
  @Post("webhooks/telegram/:secret")
  @HttpCode(200)
  async telegram(@Param("secret") secret: string, @Body() update: any) {
    if (secret !== appConfig.env.TELEGRAM_WEBHOOK_SECRET) throw new UnauthorizedException("Bad webhook secret");
    const text: string | undefined = update?.message?.text;
    if (text?.startsWith("/start ")) {
      const linked = await this.userService.completeTelegramLink(text.slice(7).trim(), String(update.message.chat.id));
      return { ok: true, linked };
    }
    const data: string | undefined = update?.callback_query?.data;
    if (data?.startsWith("ack:")) return { ok: true, ...(await this.alertService.acknowledgeByToken(data.slice(4), "telegram")) };
    return { ok: true, ignored: true };
  }

  /**
   * Development only: Postman plays the phone of a mock call.
   * In production this route does not exist (404); a real provider posts to its own webhook.
   */
  @Post("dev/mock-voice/:providerRef")
  @HttpCode(200)
  async mockVoice(@Param("providerRef") providerRef: string, @Body() dto: MockVoiceDto) {
    if (appConfig.env.NODE_ENV === "production") throw new NotFoundException();
    return await this.callService.providerEvent(providerRef, dto);
  }
}
