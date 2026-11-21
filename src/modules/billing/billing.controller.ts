import { RequirePermission, SiteContext, SiteCtx } from "@/common/decorators";
import { JwtGuard, PermissionGuard, SiteMemberGuard } from "@/common/guard";
import { appConfig } from "@/config/app.config";
import { BillingService } from "@/modules/billing/billing.service";
import { AddPackDto, ChangePlanDto, PayInvoiceDto, PaymentWebhookDto } from "@/modules/billing/dto/billing.dto";
import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, UnauthorizedException, UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(JwtGuard, SiteMemberGuard, PermissionGuard)
@RequirePermission("billing.manage") // only the owner has it by default
@Controller("sites/:siteId/billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  async overview(@SiteCtx() ctx: SiteContext) {
    return await this.billingService.overview(ctx.site.id);
  }

  @Post("plan")
  @HttpCode(200)
  async changePlan(@SiteCtx() ctx: SiteContext, @Body() dto: ChangePlanDto) {
    return await this.billingService.changePlan(ctx, dto.planCode);
  }

  @Post("items")
  async addPack(@SiteCtx() ctx: SiteContext, @Body() dto: AddPackDto) {
    return await this.billingService.addPack(ctx, dto.packCode);
  }

  @Delete("items/:itemId")
  async removePack(@SiteCtx() ctx: SiteContext, @Param("itemId", ParseUUIDPipe) itemId: string) {
    return await this.billingService.removePack(ctx, itemId);
  }

  @Post("cancel")
  @HttpCode(200)
  async cancel(@SiteCtx() ctx: SiteContext) {
    return await this.billingService.cancel(ctx);
  }

  @Get("invoices")
  async invoices(@SiteCtx() ctx: SiteContext) {
    return await this.billingService.listInvoices(ctx.site.id);
  }

  @Post("invoices/issue")
  @HttpCode(200)
  async issue(@SiteCtx() ctx: SiteContext) {
    return await this.billingService.issueInvoice(ctx.site.id);
  }

  @Get("invoices/:invoiceId")
  async invoice(@SiteCtx() ctx: SiteContext, @Param("invoiceId", ParseUUIDPipe) invoiceId: string) {
    return await this.billingService.getInvoice(ctx.site.id, invoiceId);
  }

  @Post("invoices/:invoiceId/pay")
  @HttpCode(200)
  async pay(@SiteCtx() ctx: SiteContext, @Param("invoiceId", ParseUUIDPipe) invoiceId: string, @Body() dto: PayInvoiceDto) {
    return await this.billingService.pay(ctx, invoiceId, dto.provider);
  }
}

/** Called by the payment gateway, not by a logged-in user. It proves itself with a shared secret. */
@ApiTags("webhooks")
@Controller("webhooks/payments")
export class PaymentWebhookController {
  constructor(private readonly billingService: BillingService) {}

  @Post(":provider")
  @HttpCode(200)
  async webhook(@Param("provider") provider: string, @Headers("x-webhook-secret") secret: string, @Body() dto: PaymentWebhookDto) {
    if (secret !== appConfig.env.PAYMENT_WEBHOOK_SECRET) throw new UnauthorizedException("Bad webhook secret");
    return await this.billingService.handleWebhook(provider, dto);
  }
}
