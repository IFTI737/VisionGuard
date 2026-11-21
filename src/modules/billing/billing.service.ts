import { EVENTS } from "@/common/constants/events";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { appConfig } from "@/config/app.config";
import { AuditService } from "@/modules/audit/audit.service";
import { PaymentWebhookDto } from "@/modules/billing/dto/billing.dto";
import { EntitlementService } from "@/modules/billing/entitlement.service";
import { InvoiceLine } from "@/modules/billing/entities/invoice-line.entity";
import { Invoice } from "@/modules/billing/entities/invoice.entity";
import { Payment } from "@/modules/billing/entities/payment.entity";
import { Plan } from "@/modules/billing/entities/plan.entity";
import { SubscriptionItem } from "@/modules/billing/entities/subscription-item.entity";
import { Subscription } from "@/modules/billing/entities/subscription.entity";
import { Pack } from "@/modules/catalog/entities/pack.entity";
import { Site } from "@/modules/site/entities/site.entity";
import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { DataSource, EntityManager, IsNull, LessThan, Repository } from "typeorm";

const DAY = 86400 * 1000;
const TRIAL_DAYS = 14;
const TRIAL_PLAN = "basic";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Subscription) private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(SubscriptionItem) private readonly itemRepository: Repository<SubscriptionItem>,
    @InjectRepository(Plan) private readonly planRepository: Repository<Plan>,
    @InjectRepository(Pack) private readonly packRepository: Repository<Pack>,
    @InjectRepository(Invoice) private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceLine) private readonly lineRepository: Repository<InvoiceLine>,
    @InjectRepository(Payment) private readonly paymentRepository: Repository<Payment>,
    private readonly entitlement: EntitlementService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Runs inside the transaction that creates a site: 14-day trial + the Core pack. */
  @OnEvent(EVENTS.SITE_CREATED)
  async onSiteCreated(payload: { siteId: string; manager: EntityManager }) {
    const { manager, siteId } = payload;
    const plan = await manager.findOne(Plan, { where: { code: TRIAL_PLAN } });
    if (!plan) throw new Error('Plan "basic" is missing. Run: pnpm seed');
    const now = new Date();
    const subscription = await manager.save(
      manager.create(Subscription, {
        siteId, planId: plan.id, status: "trialing",
        trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY),
        currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * DAY),
      }),
    );
    const defaults = await manager.find(Pack, { where: { isDefault: true, status: "active" } });
    for (const pack of defaults)
      await manager.save(manager.create(SubscriptionItem, { subscriptionId: subscription.id, packId: pack.id, kind: "included", unitPriceMinor: 0 }));
  }

  async overview(siteId: string) {
    const { subscription, plan, items } = await this.entitlement.forSite(siteId);
    if (!subscription || !plan) throw new NotFoundException("This site has no subscription");
    const packs = await this.packRepository.findByIds(items.map((i) => i.packId));
    const itemViews = items.map((i) => {
      const pack = packs.find((p) => p.id === i.packId)!;
      return { id: i.id, packCode: pack.code, packName: pack.name, kind: i.kind, unitPriceMinor: i.unitPriceMinor };
    });
    return {
      subscription,
      plan,
      items: itemViews,
      usage: await this.entitlement.usage(siteId),
      limits: { cameras: plan.maxCameras, members: plan.maxMembers, packSlots: plan.packSlots, recordingDays: plan.recordingDays },
      nextInvoiceEstimateMinor: plan.priceMinor + items.reduce((sum, i) => sum + i.unitPriceMinor, 0),
      currency: plan.currency,
    };
  }

  async changePlan(ctx: SiteContext, planCode: string) {
    const plan = await this.planRepository.findOne({ where: { code: planCode, active: true } });
    if (!plan) throw new NotFoundException(`Plan "${planCode}" not found`);
    const usage = await this.entitlement.usage(ctx.site.id);
    if (usage.cameras > plan.maxCameras || (plan.maxMembers !== null && usage.members > plan.maxMembers))
      throw new ConflictException({ statusCode: 409, code: "usage_exceeds_plan", message: `This site uses ${usage.cameras} cameras and ${usage.members} members, more than ${plan.name} allows. Remove some first.` });
    await this.subscriptionRepository.update({ siteId: ctx.site.id }, { planId: plan.id });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "billing.plan_change", data: { planCode } });
    return this.overview(ctx.site.id);
  }

  /** Add a pack. While the plan still has a free slot it is "included" (price 0), otherwise a paid add-on. */
  async addPack(ctx: SiteContext, packCode: string) {
    const pack = await this.packRepository.findOne({ where: { code: packCode, status: "active" } });
    if (!pack || (pack.customSiteId && pack.customSiteId !== ctx.site.id)) throw new NotFoundException(`Pack "${packCode}" not found`);
    const { subscription, plan, items } = await this.entitlement.forSite(ctx.site.id);
    if (!subscription || !plan) throw new NotFoundException("This site has no subscription");
    if (items.some((i) => i.packId === pack.id)) throw new ConflictException("This pack is already on the subscription");
    const usedSlots = items.filter((i) => i.kind === "included").length - 1; // the Core pack does not use a slot
    const free = usedSlots < plan.packSlots;
    const item = await this.itemRepository.save(
      this.itemRepository.create({ subscriptionId: subscription.id, packId: pack.id, kind: free ? "included" : "addon", unitPriceMinor: free ? 0 : pack.addonPriceMinor }),
    );
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "billing.pack_add", data: { packCode, kind: item.kind } });
    return item;
  }

  async removePack(ctx: SiteContext, itemId: string) {
    const { subscription } = await this.entitlement.forSite(ctx.site.id);
    const item = await this.itemRepository.findOne({ where: { id: itemId, subscriptionId: subscription?.id, endedAt: IsNull() } });
    if (!item) throw new NotFoundException("Item not found");
    const pack = await this.packRepository.findOneOrFail({ where: { id: item.packId } });
    if (pack.isDefault) throw new BadRequestException("The Core pack is part of every plan and cannot be removed");
    await this.itemRepository.update({ id: item.id }, { endedAt: new Date() });
    return { ...item, endedAt: new Date() };
  }

  async cancel(ctx: SiteContext) {
    await this.subscriptionRepository.update({ siteId: ctx.site.id }, { cancelAtPeriodEnd: true });
    return this.overview(ctx.site.id);
  }

  listInvoices(siteId: string) {
    return this.invoiceRepository.find({ where: { siteId }, order: { createdAt: "DESC" } });
  }

  async getInvoice(siteId: string, invoiceId: string) {
    const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId, siteId } });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return {
      ...invoice,
      lines: await this.lineRepository.find({ where: { invoiceId } }),
      payments: await this.paymentRepository.find({ where: { invoiceId }, order: { createdAt: "ASC" } }),
    };
  }

  /**
   * Creates the invoice for the current period. Safe to call twice: the
   * database allows one invoice per subscription and period
   * (UNIQUE (subscription_id, period_start)), so the second call returns the first invoice.
   */
  async issueInvoice(siteId: string) {
    const subscription = await this.subscriptionRepository.findOne({ where: { siteId } });
    if (!subscription) throw new NotFoundException("This site has no subscription");
    const existing = await this.invoiceRepository.findOne({ where: { subscriptionId: subscription.id, periodStart: subscription.currentPeriodStart } });
    if (existing) return { created: false, invoice: await this.getInvoice(siteId, existing.id) };

    const plan = await this.planRepository.findOneOrFail({ where: { id: subscription.planId } });
    const items = await this.itemRepository.find({ where: { subscriptionId: subscription.id, endedAt: IsNull() } });
    const packs = await this.packRepository.findByIds(items.map((i) => i.packId));
    const site = await this.dataSource.getRepository(Site).findOneOrFail({ where: { id: siteId } });
    try {
      const invoiceId = await this.dataSource.transaction(async (manager) => {
        await manager.query("SELECT pg_advisory_xact_lock(7001)"); // one invoice number at a time
        const [{ n }] = await manager.query("SELECT count(*)::int AS n FROM invoices");
        const number = `VG-${new Date().getFullYear()}-${String(n + 1).padStart(6, "0")}`;
        const lines = [
          { description: `${plan.name} plan`, amountMinor: plan.priceMinor, subscriptionItemId: null as string | null },
          ...items.filter((i) => i.unitPriceMinor > 0).map((i) => ({
            description: `${packs.find((p) => p.id === i.packId)?.name} pack`, amountMinor: i.unitPriceMinor, subscriptionItemId: i.id as string | null,
          })),
        ];
        const now = new Date();
        const invoice = await manager.save(
          manager.create(Invoice, {
            number, siteId, subscriptionId: subscription.id, billingName: site.name,
            periodStart: subscription.currentPeriodStart, periodEnd: subscription.currentPeriodEnd,
            status: "open", totalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0), currency: plan.currency,
            issuedAt: now, dueAt: new Date(now.getTime() + 7 * DAY),
          }),
        );
        await manager.insert(InvoiceLine, lines.map((l) => ({ ...l, invoiceId: invoice.id })));
        return invoice.id;
      });
      return { created: true, invoice: await this.getInvoice(siteId, invoiceId) };
    } catch (error: any) {
      if (error?.code === "23505") {
        // two requests at the same moment: the unique constraint let one through
        const winner = await this.invoiceRepository.findOneOrFail({ where: { subscriptionId: subscription.id, periodStart: subscription.currentPeriodStart } });
        return { created: false, invoice: await this.getInvoice(siteId, winner.id) };
      }
      throw error;
    }
  }

  /** Starts a payment. The gateway later calls our webhook with the result. */
  async pay(ctx: SiteContext, invoiceId: string, provider: "sandbox" | "bkash" | "sslcommerz") {
    const invoice = await this.invoiceRepository.findOne({ where: { id: invoiceId, siteId: ctx.site.id } });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (invoice.status !== "open") throw new ConflictException(`Invoice is ${invoice.status}, not open`);
    if (provider !== "sandbox")
      throw new BadRequestException({ statusCode: 400, code: "provider_not_configured", message: `${provider} needs a merchant account. Use "sandbox" until it is added.` });
    const payment = await this.paymentRepository.save(
      this.paymentRepository.create({ invoiceId, provider, providerTxnId: `SBX-${randomUUID().slice(0, 12).toUpperCase()}`, amountMinor: invoice.totalMinor, status: "initiated" }),
    );
    return {
      paymentId: payment.id,
      providerTxnId: payment.providerTxnId,
      amountMinor: payment.amountMinor,
      redirectUrl: `${appConfig.env.FRONTEND_URL}/billing/sandbox-pay?txn=${payment.providerTxnId}`,
      howToConfirm: "Sandbox: POST /v1/webhooks/payments/sandbox with header x-webhook-secret and body { providerTxnId, status: \"succeeded\" }",
    };
  }

  /**
   * The gateway tells us what happened. Gateways send the same webhook more
   * than once, so this must be idempotent: a payment that is already
   * "succeeded" is answered again without changing anything.
   */
  async handleWebhook(provider: string, dto: PaymentWebhookDto) {
    const payment = await this.paymentRepository.findOne({ where: { provider: provider as any, providerTxnId: dto.providerTxnId } });
    if (!payment) throw new NotFoundException("Unknown transaction");
    if (payment.status !== "initiated") return { received: true, duplicate: true, paymentStatus: payment.status };
    if (dto.amountMinor !== undefined && dto.amountMinor !== payment.amountMinor)
      throw new BadRequestException("Amount does not match the invoice");

    await this.dataSource.transaction(async (manager) => {
      // the WHERE status = 'initiated' makes two simultaneous webhooks safe: only one updates a row
      const updated = await manager.update(Payment, { id: payment.id, status: "initiated" }, { status: dto.status, confirmedAt: new Date(), raw: { ...dto } as any });
      if (!updated.affected || dto.status !== "succeeded") return;
      const invoice = await manager.findOneOrFail(Invoice, { where: { id: payment.invoiceId } });
      await manager.update(Invoice, { id: invoice.id }, { status: "paid", paidAt: new Date() });
      if (invoice.subscriptionId)
        await manager.update(Subscription, { id: invoice.subscriptionId }, { status: "active", graceUntil: null });
    });
    this.logger.log(`payment ${dto.providerTxnId} -> ${dto.status}`);
    return { received: true, duplicate: false, paymentStatus: dto.status };
  }

  /** Daily job: unpaid invoices past their due date put the subscription in "past_due" with 7 days of grace. */
  async markPastDue() {
    const overdue = await this.invoiceRepository.find({ where: { status: "open", dueAt: LessThan(new Date()) } });
    for (const invoice of overdue) {
      if (!invoice.subscriptionId) continue;
      await this.subscriptionRepository.update(
        { id: invoice.subscriptionId, status: "active" },
        { status: "past_due", graceUntil: new Date(Date.now() + 7 * DAY) },
      );
    }
    return overdue.length;
  }

  /** Daily job: when a period ends, start the next one and issue its invoice. */
  async renewDue() {
    const due = await this.subscriptionRepository.find({ where: { currentPeriodEnd: LessThan(new Date()) } });
    for (const subscription of due) {
      if (subscription.cancelAtPeriodEnd) {
        await this.subscriptionRepository.update({ id: subscription.id }, { status: "cancelled" });
        continue;
      }
      const start = subscription.currentPeriodEnd;
      await this.subscriptionRepository.update(
        { id: subscription.id },
        { currentPeriodStart: start, currentPeriodEnd: new Date(start.getTime() + 30 * DAY), status: subscription.status === "trialing" ? "active" : subscription.status },
      );
      await this.issueInvoice(subscription.siteId);
    }
    return due.length;
  }
}
