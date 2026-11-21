import { EVENTS } from "@/common/constants/events";
import { SEVERITY_ORDER, ROLE_PRESETS } from "@/common/constants/permissions";
import { randomToken, sha256 } from "@/common/helpers/crypto.helper";
import { paged } from "@/common/dto/page-query.dto";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { CreateAlertDto, ListAlertsDto } from "@/modules/alert/dto/alert.dto";
import { AlertRecipient } from "@/modules/alert/entities/alert-recipient.entity";
import { Alert } from "@/modules/alert/entities/alert.entity";
import { DeliveryAttempt } from "@/modules/alert/entities/delivery-attempt.entity";
import { EscalationStep } from "@/modules/alert/entities/escalation-step.entity";
import { PolicyService } from "@/modules/alert/policy.service";
import { MemberAreaScope } from "@/modules/site/entities/member-area-scope.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { InjectQueue } from "@nestjs/bull";
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bull";
import { randomUUID } from "crypto";
import { DataSource, In, Repository } from "typeorm";

const NONE = ["00000000-0000-0000-0000-000000000000"];
const GROUP_WINDOW_S = 120; // incidents this close together share one alert

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @InjectRepository(Alert) private readonly alertRepository: Repository<Alert>,
    @InjectRepository(AlertRecipient) private readonly recipientRepository: Repository<AlertRecipient>,
    @InjectRepository(DeliveryAttempt) private readonly attemptRepository: Repository<DeliveryAttempt>,
    @InjectRepository(SiteMember) private readonly memberRepository: Repository<SiteMember>,
    @InjectRepository(MemberAreaScope) private readonly scopeRepository: Repository<MemberAreaScope>,
    @InjectQueue(QUEUE.ESCALATION) private readonly escalationQueue: Queue,
    @InjectQueue(QUEUE.DELIVERY) private readonly deliveryQueue: Queue,
    private readonly policies: PolicyService,
    private readonly dataSource: DataSource,
    private readonly redis: RedisCacheService,
    private readonly events: EventEmitter2,
  ) {}

  // =====================================================================
  // Creating alerts
  // =====================================================================

  /** Called by the incident worker. Several incidents within 2 minutes share one alert (one alarm, not five). */
  async raiseForIncident(input: { siteId: string; areaId: string; incidentId: string; title: string; body: string; severity: Alert["severity"]; riskScore: number }) {
    const [recent] = await this.dataSource.query(
      `SELECT id FROM alerts WHERE site_id = $1 AND source = 'system' AND status = 'active'
       AND created_at > now() - make_interval(secs => $2) ORDER BY created_at DESC LIMIT 1`,
      [input.siteId, GROUP_WINDOW_S],
    );
    let alertId: string = recent?.id;
    if (!alertId) {
      const policy = await this.policies.defaultFor(input.siteId);
      const alert = await this.alertRepository.save(
        this.alertRepository.create({ siteId: input.siteId, source: "system", title: input.title, body: input.body, severity: input.severity, riskScore: input.riskScore, policyId: policy?.policy.id ?? null }),
      );
      alertId = alert.id;
      await this.startEscalation(alert, input.areaId);
    }
    await this.dataSource.query(`UPDATE incidents SET alert_id = $1 WHERE id = $2`, [alertId, input.incidentId]);
    return alertId;
  }

  /**
   * A person presses "Send alert". The Idempotency-Key header makes a double tap
   * (or a retry on a bad connection) create one alert, not two: the database has
   * a unique index on (site, sender, key), and the second request gets the first alert back.
   */
  async createManual(ctx: SiteContext, dto: CreateAlertDto, idempotencyKey?: string) {
    try {
      const policy = await this.policies.defaultFor(ctx.site.id);
      const alert = await this.alertRepository.save(
        this.alertRepository.create({
          siteId: ctx.site.id, source: "manual", senderMemberId: ctx.member.id, title: dto.title, body: dto.body ?? null,
          severity: dto.severity, clientRequestId: idempotencyKey ?? null, policyId: policy?.policy.id ?? null,
        }),
      );
      await this.startEscalation(alert, dto.areaId ?? null);
      return { created: true, alert };
    } catch (error: any) {
      if (error?.code === "23505" && idempotencyKey) {
        const existing = await this.alertRepository.findOneOrFail({ where: { siteId: ctx.site.id, senderMemberId: ctx.member.id, clientRequestId: idempotencyKey } });
        return { created: false, alert: existing };
      }
      throw error;
    }
  }

  /** "Does my phone get it?" Goes only to the person who asked. No escalation, no calls. */
  async createTest(ctx: SiteContext) {
    const alert = await this.alertRepository.save(
      this.alertRepository.create({ siteId: ctx.site.id, source: "test", senderMemberId: ctx.member.id, title: "Test alert", body: "This is a test. Nothing is wrong.", severity: "low" }),
    );
    const token = randomToken();
    const recipient = await this.recipientRepository.save(this.recipientRepository.create({ alertId: alert.id, siteId: ctx.site.id, memberId: ctx.member.id, stepNo: 1, ackTokenHash: sha256(token) }));
    for (const channel of ["inapp", "webpush", "telegram"])
      await this.deliveryQueue.add("send", { recipientId: recipient.id, channel, ackToken: token, attemptNo: 1 }, { removeOnComplete: true });
    return { alert, ackToken: token };
  }

  // =====================================================================
  // Escalation (delayed jobs in the "escalation" queue)
  // =====================================================================

  private async startEscalation(alert: Alert, areaId: string | null) {
    this.events.emit(EVENTS.ALERT_UPDATED, { siteId: alert.siteId, id: alert.id, status: alert.status, currentStep: 0 });
    if (!alert.policyId) return;
    const steps = await this.policies.steps(alert.policyId);
    if (!steps.length) return;
    await this.redis.getClient().set(`alertarea:${alert.id}`, areaId ?? "", { EX: 86400 });
    await this.schedule(alert.id, "step", { alertId: alert.id, stepNo: 1, round: 0 }, steps[0].waitS * 1000, `esc:${alert.id}:0:1`);
  }

  /** Adds a delayed job and remembers its id, so acknowledging can remove everything that is still waiting. */
  async schedule(alertId: string, name: string, data: object, delayMs: number, jobId: string) {
    const queue = name === "step" || name === "exhaust" ? this.escalationQueue : this.deliveryQueue;
    await queue.add(name, data, { jobId, delay: delayMs, attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true });
    await this.redis.getClient().sAdd(`escjobs:${alertId}`, `${queue.name}|${jobId}`);
    await this.redis.getClient().expire(`escjobs:${alertId}`, 86400);
  }

  /**
   * One step of the policy. Runs as a delayed job.
   * The first thing it does is lock the alert row and look at its status:
   * if somebody acknowledged in the meantime, it stops. Removing the waiting
   * jobs (in acknowledge) is only the fast path; this re-check is the guarantee
   * that nobody is called after an acknowledgement.
   */
  async runStep(alertId: string, stepNo: number, round: number) {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const alert = await manager.getRepository(Alert).createQueryBuilder("a").setLock("pessimistic_write").where("a.id = :alertId", { alertId }).getOne();
      if (!alert || alert.status !== "active" || !alert.policyId) return null;
      const steps = await this.policies.steps(alert.policyId);
      const step = steps.find((s) => s.stepNo === stepNo);
      if (!step) return null;
      const policy = await this.policies.defaultFor(alert.siteId);
      // phone calls only for alerts at or above the policy's minimum severity
      const channels = step.channels.filter((c) => c !== "call" || SEVERITY_ORDER[alert.severity] >= SEVERITY_ORDER[(policy?.policy.minSeverity ?? "low") as keyof typeof SEVERITY_ORDER]);

      const areaId = (await this.redis.getClient().get(`alertarea:${alertId}`)) || null;
      const members = await this.audience(alert.siteId, step, areaId);
      const created: { recipientId: string; memberId: string; token: string }[] = [];
      for (const member of members) {
        const token = randomToken();
        const result = await manager.createQueryBuilder().insert().into(AlertRecipient)
          .values({ alertId, siteId: alert.siteId, memberId: member.id, stepNo, ackTokenHash: sha256(token) })
          .orIgnore().returning("id").execute(); // a member already told in an earlier step keeps that row
        if (result.raw[0]) created.push({ recipientId: result.raw[0].id, memberId: member.id, token });
      }
      await manager.update(Alert, { id: alertId }, { currentStep: stepNo });
      return { alert, step, steps, channels, created, repeatCount: policy?.policy.repeatCount ?? 0 };
    });
    if (!outcome) return;
    const { alert, step, steps, channels, created, repeatCount } = outcome;

    for (const recipient of created)
      for (const channel of channels.filter((c) => c !== "call"))
        await this.deliveryQueue.add("send", { recipientId: recipient.recipientId, channel, ackToken: recipient.token, attemptNo: round + 1 }, { attempts: 2, backoff: 3000, removeOnComplete: true });
    if (channels.includes("call")) await this.schedule(alertId, "call", { alertId, stepNo, order: 0 }, 0, `call:${alertId}:${round}:${stepNo}:0`);

    this.events.emit(EVENTS.ALERT_UPDATED, { siteId: alert.siteId, id: alertId, status: "active", currentStep: stepNo });
    this.logger.log(`alert ${alertId} step ${stepNo}: ${created.length} new recipients, channels ${channels.join(",") || "(none)"}`);

    const next = steps.find((s) => s.stepNo === stepNo + 1);
    if (next) return this.schedule(alertId, "step", { alertId, stepNo: next.stepNo, round }, next.waitS * 1000, `esc:${alertId}:${round}:${next.stepNo}`);
    if (round < repeatCount) return this.schedule(alertId, "step", { alertId, stepNo: 1, round: round + 1 }, 60_000, `esc:${alertId}:${round + 1}:1`);
    // last step: give the calls time to ring out, then give up
    const wait = step.channels.includes("call") ? step.callCount * step.ringTimeoutS + 15 : 60;
    return this.schedule(alertId, "exhaust", { alertId }, wait * 1000, `esc:${alertId}:exhaust`);
  }

  /** Nobody reacted. The alert is closed as "exhausted" and the sender is told. */
  async exhaust(alertId: string) {
    const result = await this.alertRepository.update({ id: alertId, status: "active" }, { status: "exhausted", closedAt: new Date() });
    if (!result.affected) return;
    const alert = await this.alertRepository.findOneOrFail({ where: { id: alertId } });
    await this.recipientRepository.update({ alertId, status: In(["pending", "notified"]) }, { status: "unreachable" });
    this.events.emit(EVENTS.ALERT_UPDATED, { siteId: alert.siteId, id: alertId, status: "exhausted", currentStep: alert.currentStep });
    this.logger.warn(`alert ${alertId} exhausted: nobody acknowledged`);
  }

  async audience(siteId: string, step: EscalationStep, areaId: string | null) {
    let members = await this.memberRepository.find({ where: { siteId, status: "active" }, order: { callPriority: "ASC" } });
    if (step.audience === "call_list") return members.filter((m) => m.callPriority !== null).slice(0, step.callCount);
    if (step.audience === "role") members = members.filter((m) => m.role === step.role);
    else members = members.filter((m) => m.userId && [...(ROLE_PRESETS[m.role] ?? []), ...m.permissions].includes("alerts.receive"));
    if (!areaId) return members;
    // a helper limited to other areas is not told about this one
    const scopes = await this.scopeRepository.find({ where: { siteId, memberId: In(members.length ? members.map((m) => m.id) : NONE) } });
    return members.filter((m) => m.allAreas || scopes.some((s) => s.memberId === m.id && s.areaId === areaId));
  }

  // =====================================================================
  // Acknowledging
  // =====================================================================

  /**
   * The WHERE status = 'active' makes this safe when two people tap at the same
   * moment: PostgreSQL lets exactly one UPDATE change the row. The other gets
   * "0 rows" and is simply shown who acknowledged first.
   */
  async acknowledge(alertId: string, memberId: string | null, via: "app" | "telegram" | "webpush" | "call") {
    const result = await this.alertRepository.update(
      { id: alertId, status: "active" },
      { status: "acknowledged", acknowledgedBy: memberId, acknowledgedVia: via, acknowledgedAt: new Date(), closedAt: new Date() },
    );
    const alert = await this.alertRepository.findOne({ where: { id: alertId } });
    if (!alert) throw new NotFoundException("Alert not found");
    if (!result.affected) return { alert, acknowledgedNow: false };

    await this.removeWaitingJobs(alertId);
    if (memberId) await this.recipientRepository.update({ alertId, memberId }, { status: "acknowledged", ackedAt: new Date() });
    // phones that are still ringing are hung up
    await this.dataSource.query(
      `UPDATE delivery_attempts SET status = 'cancelled', completed_at = now()
       WHERE status IN ('queued','ringing') AND recipient_id IN (SELECT id FROM alert_recipients WHERE alert_id = $1)`,
      [alertId],
    );
    await this.dataSource.query(
      `UPDATE incidents SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now() WHERE alert_id = $1 AND status = 'open'`,
      [alertId, memberId],
    );
    this.events.emit(EVENTS.ALERT_UPDATED, { siteId: alert.siteId, id: alertId, status: "acknowledged", currentStep: alert.currentStep, acknowledgedBy: memberId });
    return { alert, acknowledgedNow: true };
  }

  /** From a Telegram button, a push notification or a phone key press: the one-time token says who it is. */
  async acknowledgeByToken(token: string, via: "telegram" | "webpush" | "call") {
    const recipient = await this.recipientRepository.createQueryBuilder("r").where("r.ackTokenHash = :hash", { hash: sha256(token) }).getOne();
    if (!recipient) throw new NotFoundException("This acknowledge link is not valid");
    const { alert, acknowledgedNow } = await this.acknowledge(recipient.alertId, recipient.memberId, via);
    return { status: alert.status, acknowledgedBy: alert.acknowledgedBy, acknowledgedNow };
  }

  async cancel(ctx: SiteContext, alertId: string) {
    const alert = await this.findOrFail(ctx.site.id, alertId);
    if (alert.senderMemberId !== ctx.member.id && ctx.member.role !== "owner") throw new ForbiddenException("Only the sender or the owner can cancel an alert");
    const result = await this.alertRepository.update({ id: alertId, status: "active" }, { status: "cancelled", closedAt: new Date() });
    if (!result.affected) throw new ConflictException(`Alert is already ${alert.status}`);
    await this.removeWaitingJobs(alertId);
    this.events.emit(EVENTS.ALERT_UPDATED, { siteId: alert.siteId, id: alertId, status: "cancelled", currentStep: alert.currentStep });
    return this.findOrFail(ctx.site.id, alertId);
  }

  private async removeWaitingJobs(alertId: string) {
    const client = this.redis.getClient();
    for (const entry of await client.sMembers(`escjobs:${alertId}`)) {
      const [queueName, jobId] = entry.split("|");
      const queue = queueName === QUEUE.ESCALATION ? this.escalationQueue : this.deliveryQueue;
      try {
        await (await queue.getJob(jobId))?.remove();
      } catch {
        // the job is running right now; it will see the new status and stop by itself
      }
    }
    await client.del(`escjobs:${alertId}`);
  }

  // =====================================================================
  // Reading
  // =====================================================================

  async list(siteId: string, query: ListAlertsDto) {
    const [items, total] = await this.alertRepository.findAndCount({
      where: { siteId, ...(query.status ? { status: query.status } : {}), ...(query.source ? { source: query.source } : {}) },
      order: { createdAt: "DESC" }, take: query.limit, skip: query.offset,
    });
    return paged(items, total, query);
  }

  /** The whole story of one alert: who was told, on which channel, what happened, who acknowledged. */
  async getOne(siteId: string, alertId: string) {
    const alert = await this.findOrFail(siteId, alertId);
    const recipients = await this.recipientRepository.find({ where: { alertId }, order: { stepNo: "ASC" } });
    const members = await this.memberRepository.find({ where: { id: In(recipients.length ? recipients.map((r) => r.memberId) : NONE) } });
    const attempts = await this.attemptRepository.find({ where: { recipientId: In(recipients.length ? recipients.map((r) => r.id) : NONE) }, order: { createdAt: "ASC" } });
    const incidents = await this.dataSource.query(`SELECT id, title, status, severity, risk_score AS "riskScore" FROM incidents WHERE alert_id = $1`, [alertId]);
    return {
      ...alert,
      incidents,
      recipients: recipients.map((r) => ({
        id: r.id, memberId: r.memberId, name: members.find((m) => m.id === r.memberId)?.displayName, stepNo: r.stepNo, status: r.status, notifiedAt: r.notifiedAt, ackedAt: r.ackedAt,
        attempts: attempts.filter((a) => a.recipientId === r.id).map((a) => ({ id: a.id, channel: a.channel, attemptNo: a.attemptNo, status: a.status, provider: a.provider, providerRef: a.providerRef, error: a.error, meta: a.meta, createdAt: a.createdAt, completedAt: a.completedAt })),
      })),
    };
  }

  async findOrFail(siteId: string, alertId: string) {
    const alert = await this.alertRepository.findOne({ where: { id: alertId, siteId } });
    if (!alert) throw new NotFoundException("Alert not found");
    return alert;
  }

  newProviderRef() {
    return `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
  }
}
