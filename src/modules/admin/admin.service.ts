import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { PageQueryDto, paged } from "@/common/dto/page-query.dto";
import { CustomPackDto, UpdateUserByAdminDto } from "@/modules/admin/dto/admin.dto";
import { AuditService } from "@/modules/audit/audit.service";
import { AuditLog } from "@/modules/audit/entities/audit-log.entity";
import { SubscriptionItem } from "@/modules/billing/entities/subscription-item.entity";
import { Subscription } from "@/modules/billing/entities/subscription.entity";
import { Pack } from "@/modules/catalog/entities/pack.entity";
import { RuleTemplate } from "@/modules/catalog/entities/rule-template.entity";
import { DetectionFeedback } from "@/modules/incident/entities/detection-feedback.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { User } from "@/modules/user/entities/user.entity";
import { UserService } from "@/modules/user/user.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { InjectQueue } from "@nestjs/bull";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bull";
import { DataSource, ILike, Repository } from "typeorm";

const CACHE_S = 300; // dashboard numbers may be 5 minutes old

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Site) private readonly siteRepository: Repository<Site>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(AuditLog) private readonly auditRepository: Repository<AuditLog>,
    @InjectRepository(DetectionFeedback) private readonly feedbackRepository: Repository<DetectionFeedback>,
    @InjectQueue(QUEUE.INCIDENT) private readonly incidentQueue: Queue,
    @InjectQueue(QUEUE.ESCALATION) private readonly escalationQueue: Queue,
    @InjectQueue(QUEUE.DELIVERY) private readonly deliveryQueue: Queue,
    @InjectQueue(QUEUE.MAINTENANCE) private readonly maintenanceQueue: Queue,
    @InjectQueue(QUEUE.EXPORT) private readonly exportQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly redis: RedisCacheService,
    private readonly audit: AuditService,
    private readonly userService: UserService,
  ) {}

  // ---------------- sites ----------------

  async listSites(query: PageQueryDto) {
    const [items, total] = await this.siteRepository.findAndCount({
      where: query.q ? { name: ILike(`%${query.q}%`) } : {},
      select: ["id", "name", "kind", "status", "createdAt"], order: { createdAt: "DESC" }, take: query.limit, skip: query.offset,
    });
    return paged(items, total, query);
  }

  /**
   * What staff may see of a customer's site: numbers and titles, never pictures
   * or video. Every look is written to the audit log with the staff member's id.
   */
  async siteSummary(staff: AuthUser, siteId: string, ip?: string) {
    const site = await this.siteRepository.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException("Site not found");
    const [counts] = await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM cameras WHERE site_id = $1 AND deleted_at IS NULL) AS cameras,
              (SELECT count(*)::int FROM site_members WHERE site_id = $1 AND status = 'active') AS members,
              (SELECT count(*)::int FROM incidents WHERE site_id = $1 AND status = 'open') AS "openIncidents",
              (SELECT p.name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.site_id = $1) AS plan,
              (SELECT s.status FROM subscriptions s WHERE s.site_id = $1) AS "subscriptionStatus"`,
      [siteId],
    );
    const recentIncidents = await this.dataSource.query(`SELECT title, severity, status, started_at AS "startedAt" FROM incidents WHERE site_id = $1 ORDER BY started_at DESC LIMIT 10`, [siteId]);
    await this.audit.log({ siteId, actorKind: "staff", actorId: staff.id, action: "admin.site.view", entityType: "site", entityId: siteId, ip });
    return { site: { id: site.id, name: site.name, kind: site.kind, status: site.status }, ...counts, recentIncidents };
  }

  async setSiteStatus(staff: AuthUser, siteId: string, status: "active" | "suspended") {
    const result = await this.siteRepository.update({ id: siteId }, { status });
    if (!result.affected) throw new NotFoundException("Site not found");
    await this.audit.log({ siteId, actorKind: "staff", actorId: staff.id, action: `admin.site.${status === "suspended" ? "suspend" : "unsuspend"}`, entityType: "site", entityId: siteId });
    return this.siteRepository.findOneOrFail({ where: { id: siteId }, select: ["id", "name", "status"] });
  }

  /** A pack made for one customer after a feature request: private to that site, at an agreed price. */
  async createCustomPack(staff: AuthUser, siteId: string, dto: CustomPackDto) {
    const site = await this.siteRepository.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException("Site not found");
    // copy only from the public catalog, never from another customer's custom pack
    const sources = await this.dataSource.getRepository(RuleTemplate).createQueryBuilder("t")
      .innerJoin(Pack, "p", "p.id = t.packId AND p.customSiteId IS NULL")
      .where("t.code IN (:...codes)", { codes: dto.templateCodes.length ? dto.templateCodes : ["-"] }).getMany();
    if (sources.length !== new Set(dto.templateCodes).size) throw new BadRequestException("Every templateCode must be an existing rule template");
    const result = await this.dataSource.transaction(async (manager) => {
      const subscription = await manager.findOne(Subscription, { where: { siteId } });
      if (!subscription) throw new BadRequestException("This site has no subscription");
      const n = await manager.count(Pack);
      const pack = await manager.save(manager.create(Pack, { code: `custom_${n + 1}`, name: dto.name, description: `Custom pack for ${site.name}`, customSiteId: siteId, addonPriceMinor: dto.priceMinor }));
      for (const source of sources) {
        const { id: _id, packId: _packId, ...copy } = source;
        await manager.save(manager.create(RuleTemplate, { ...copy, packId: pack.id }));
      }
      const item = await manager.save(manager.create(SubscriptionItem, { subscriptionId: subscription.id, packId: pack.id, kind: "custom", unitPriceMinor: dto.priceMinor }));
      return { pack, item };
    });
    await this.audit.log({ siteId, actorKind: "staff", actorId: staff.id, action: "admin.custom_pack.create", entityType: "pack", entityId: result.pack.id, data: { priceMinor: dto.priceMinor } });
    return result;
  }

  // ---------------- users ----------------

  async listUsers(query: PageQueryDto) {
    const [items, total] = await this.userRepository.findAndCount({
      where: query.q ? [{ name: ILike(`%${query.q}%`) }, { email: ILike(`%${query.q}%`) }] : {},
      select: ["id", "name", "email", "platformRole", "status", "lastLoginAt", "createdAt"], order: { createdAt: "DESC" }, take: query.limit, skip: query.offset,
    });
    return paged(items, total, query);
  }

  async updateUser(staff: AuthUser, userId: string, dto: UpdateUserByAdminDto) {
    if (userId === staff.id) throw new BadRequestException("You cannot change your own account here");
    const result = await this.userRepository.update({ id: userId }, dto);
    if (!result.affected) throw new NotFoundException("User not found");
    await this.userService.invalidateAuthState(userId); // the change applies to the user's very next request
    await this.audit.log({ actorKind: "staff", actorId: staff.id, action: "admin.user.update", entityType: "user", entityId: userId, data: { ...dto } });
    return this.userRepository.findOneOrFail({ where: { id: userId }, select: ["id", "name", "email", "platformRole", "status"] });
  }

  // ---------------- metrics (admin role only) ----------------

  /** Money actually received, per month and per plan. Read from invoices with status "paid". */
  revenue() {
    return this.redis.getIfCached("admin:revenue", CACHE_S, async () => {
      const perMonth = await this.dataSource.query(
        `SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, sum(total_minor)::int AS "paidMinor", count(*)::int AS invoices
         FROM invoices WHERE status = 'paid' GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
      );
      const perPlan = await this.dataSource.query(
        `SELECT p.name AS plan, sum(i.total_minor)::int AS "paidMinor" FROM invoices i
         JOIN subscriptions s ON s.id = i.subscription_id JOIN plans p ON p.id = s.plan_id WHERE i.status = 'paid' GROUP BY p.name ORDER BY 2 DESC`,
      );
      const [totals] = await this.dataSource.query(
        `SELECT coalesce(sum(total_minor) FILTER (WHERE status = 'paid'), 0)::int AS "paidMinor",
                coalesce(sum(total_minor) FILTER (WHERE status = 'open'), 0)::int AS "openMinor",
                (SELECT count(*)::int FROM payments WHERE status = 'failed') AS "failedPayments" FROM invoices`,
      );
      return { currency: "BDT", totals, perMonth, perPlan, cachedForSeconds: CACHE_S };
    });
  }

  subscriptions() {
    return this.redis.getIfCached("admin:subscriptions", CACHE_S, async () => {
      const byStatus = await this.dataSource.query(`SELECT status, count(*)::int AS n FROM subscriptions GROUP BY status`);
      const byPlan = await this.dataSource.query(`SELECT p.name AS plan, count(*)::int AS n FROM subscriptions s JOIN plans p ON p.id = s.plan_id GROUP BY p.name`);
      const addons = await this.dataSource.query(`SELECT k.name AS pack, count(*)::int AS n FROM subscription_items i JOIN packs k ON k.id = i.pack_id WHERE i.ended_at IS NULL AND i.kind <> 'included' GROUP BY k.name`);
      return { byStatus, byPlan, addons };
    });
  }

  usage() {
    return this.redis.getIfCached("admin:usage", CACHE_S, async () => {
      const [row] = await this.dataSource.query(
        `SELECT (SELECT count(*)::int FROM users) AS users,
                (SELECT count(*)::int FROM sites WHERE status = 'active' AND deleted_at IS NULL) AS "activeSites",
                (SELECT count(*)::int FROM cameras WHERE deleted_at IS NULL) AS cameras,
                (SELECT count(*)::int FROM cameras WHERE status = 'online' AND deleted_at IS NULL) AS "camerasOnline",
                (SELECT count(*)::int FROM incidents WHERE created_at > now() - interval '24 hours') AS "incidents24h",
                (SELECT count(*)::int FROM alerts WHERE created_at > now() - interval '24 hours') AS "alerts24h",
                (SELECT count(*)::int FROM support_tickets WHERE status IN ('open','in_progress')) AS "openTickets"`,
      );
      const delivery = await this.dataSource.query(`SELECT channel, status, count(*)::int AS n FROM delivery_attempts WHERE created_at > now() - interval '7 days' GROUP BY channel, status ORDER BY channel`);
      return { ...row, delivery7d: delivery };
    });
  }

  // ---------------- feedback, audit, health ----------------

  async feedback(query: PageQueryDto) {
    const [items, total] = await this.feedbackRepository.findAndCount({ order: { createdAt: "DESC" }, take: query.limit, skip: query.offset });
    return paged(items, total, query);
  }

  async auditLog(query: PageQueryDto, siteId?: string, action?: string) {
    const [items, total] = await this.auditRepository.findAndCount({
      where: { ...(siteId ? { siteId } : {}), ...(action ? { action } : {}) }, order: { id: "DESC" }, take: query.limit, skip: query.offset,
    });
    return paged(items, total, query);
  }

  async health() {
    const started = Date.now();
    await this.dataSource.query("SELECT 1");
    const databaseMs = Date.now() - started;
    const redisPing = await this.redis.getClient().ping();
    const queues: Record<string, unknown> = {};
    for (const queue of [this.incidentQueue, this.escalationQueue, this.deliveryQueue, this.maintenanceQueue, this.exportQueue])
      queues[queue.name] = await queue.getJobCounts(); // waiting, active, delayed, failed...
    const [partition] = await this.dataSource.query(`SELECT count(*)::int AS n FROM zone_metric_minutes_default`);
    return {
      database: { ok: true, ms: databaseMs }, redis: { ok: redisPing === "PONG" }, queues,
      // rows here mean the daily partition job missed a day
      defaultPartitionRows: partition.n,
    };
  }
}
