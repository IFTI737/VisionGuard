import { EVENTS } from "@/common/constants/events";
import { signPayload, verifyPayload } from "@/common/helpers/crypto.helper";
import { paged } from "@/common/dto/page-query.dto";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { appConfig } from "@/config/app.config";
import { AlertService } from "@/modules/alert/alert.service";
import { AuditService } from "@/modules/audit/audit.service";
import { riskAction, riskScore } from "@/modules/engine/core/engine";
import { isNight, isWithinSchedule } from "@/modules/engine/core/schedule";
import { FalseAlarmDto, ListIncidentsDto } from "@/modules/incident/dto/incident.dto";
import { DetectionFeedback } from "@/modules/incident/entities/detection-feedback.entity";
import { IncidentEvent } from "@/modules/incident/entities/incident-event.entity";
import { Incident } from "@/modules/incident/entities/incident.entity";
import { RuleTransitionJob } from "@/modules/ingestion/ingestion.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

/** What the rule is about. Part of the dedup key, so "cow missing" and "person at night" in one zone stay separate. */
export function subjectOf(kind: string, p: any): string {
  switch (kind) {
    case "presence": return p.subjects.join("+");
    case "count_range": return p.subject;
    case "attribute_missing": return `${p.subject}:${p.required.join("+")}`;
    case "proximity": return `${p.a}~${p.b}`;
    case "measure_threshold": return p.measure;
    case "delta": case "anomaly": return p.metric;
    case "device_health": return p.check;
    default: return "unknown";
  }
}

@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    @InjectRepository(Incident) private readonly incidentRepository: Repository<Incident>,
    @InjectRepository(IncidentEvent) private readonly eventRepository: Repository<IncidentEvent>,
    @InjectRepository(DetectionFeedback) private readonly feedbackRepository: Repository<DetectionFeedback>,
    private readonly dataSource: DataSource,
    private readonly alerts: AlertService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly redis: RedisCacheService,
  ) {}

  // =====================================================================
  // Called by the queue worker when a rule fires, fires again, or clears
  // =====================================================================

  async handleTransition(job: RuleTransitionJob) {
    const dedupKey = `${job.zoneId ?? job.cameraId}:${job.rule.kind}:${subjectOf(job.rule.kind, job.rule.params)}`;
    if (job.type === "clear") return this.conditionCleared(job, dedupKey);

    const result = job.result!;
    const at = new Date(job.at);
    const durationS = Math.max(0, (job.at - (job.state.firstViolatedAt ?? job.at)) / 1000);
    const risk = riskScore({
      severity: job.rule.severity,
      // night, or inside the rule's own restricted hours
      timeContext: isNight(job.at, job.timezone) || (job.rule.schedule && isWithinSchedule(job.rule.schedule, job.at, job.timezone)) ? 1 : 0,
      magnitude: result.magnitude,
      durationS, sustainS: job.rule.sustainS,
      anomaly: result.unit === "z" ? result.magnitude : 0,
      avgConf: result.avgConf,
      fpRate7d: await this.falseAlarmRate(job.rule.id),
      sensitivity: job.sensitivity,
    });
    const title = this.title(job, "en");
    const expected = { ruleVersion: job.rule.version, params: { kind: job.rule.kind, ...job.rule.params }, schedule: job.rule.schedule, sustainS: job.rule.sustainS, text: { en: title, bn: this.title(job, "bn") } };
    const observed = {
      value: result.value, peak: job.state.peak ?? result.value, unit: result.unit, counts: job.counts,
      boxes: result.boxes.map((b) => ({ cls: b.cls, conf: b.conf, box: b.box, attrs: b.attrs })), avgConf: result.avgConf, baseline: result.baseline,
      firstViolatedAt: new Date(job.state.firstViolatedAt ?? job.at).toISOString(),
      violationRatio: job.state.samples ? job.state.violating / job.state.samples : 1, durationS, risk: risk.parts,
    };

    // One open incident per dedup key. The partial unique index
    //   uq_incidents_open_dedup (dedup_key) WHERE status IN ('open','acknowledged')
    // makes this safe even when two workers run at the same moment:
    // the second INSERT becomes an UPDATE of the same row (recurrence + 1).
    const [row] = await this.dataSource.query(
      `INSERT INTO incidents (site_id, rule_id, zone_id, camera_id, kind, title, severity, risk_score, dedup_key,
                              started_at, last_seen_at, clip_from, clip_to, expected, observed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10, $10::timestamptz - interval '30 seconds', $10::timestamptz + interval '60 seconds', $11, $12)
       ON CONFLICT (dedup_key) WHERE status IN ('open','acknowledged') DO UPDATE SET
         recurrence = incidents.recurrence + 1, last_seen_at = EXCLUDED.last_seen_at, condition_active = true, ended_at = NULL,
         risk_score = GREATEST(incidents.risk_score, EXCLUDED.risk_score), observed = EXCLUDED.observed, updated_at = now()
       RETURNING id, (xmax = 0) AS inserted, recurrence, risk_score AS "riskScore", alert_id AS "alertId", status`,
      [job.siteId, job.rule.id, job.zoneId, job.cameraId, job.rule.kind, title, job.rule.severity, risk.score, dedupKey, at, JSON.stringify(expected), JSON.stringify(observed)],
    );
    await this.eventRepository.insert({ incidentId: row.id, type: row.inserted ? "created" : "recurred", data: { riskScore: risk.score, value: result.value } as any });

    if (row.inserted)
      this.events.emit(EVENTS.INCIDENT_CREATED, { siteId: job.siteId, areaId: job.areaId, id: row.id, zoneId: job.zoneId, cameraId: job.cameraId, title, severity: job.rule.severity, riskScore: risk.score, startedAt: at.toISOString() });
    else
      this.events.emit(EVENTS.INCIDENT_UPDATED, { siteId: job.siteId, areaId: job.areaId, id: row.id, status: row.status, conditionActive: true, recurrence: row.recurrence });

    // The risk score decides how loud we are: log < in-app only < alert < urgent
    const action = riskAction(risk.score);
    if ((action === "alert" || action === "urgent") && !row.alertId && row.status === "open") {
      const alertId = await this.alerts.raiseForIncident({
        siteId: job.siteId, areaId: job.areaId, incidentId: row.id, title,
        body: `${job.siteName}: ${title}. Risk ${risk.score}/100.`, severity: job.rule.severity, riskScore: risk.score,
      });
      await this.eventRepository.insert({ incidentId: row.id, type: "alert_sent", data: { alertId } as any });
    }
    this.logger.log(`incident ${row.inserted ? "created" : "recurred"} ${row.id} "${title}" risk=${risk.score} action=${action}`);
    return row.id as string;
  }

  /** The problem stopped by itself. The incident stays open until a person closes it, but shows "condition over". */
  private async conditionCleared(job: RuleTransitionJob, dedupKey: string) {
    // "AND last_seen_at <= $2": a clear that arrives late (a retried job) must not undo a newer re-fire
    const result = await this.dataSource.query(
      `UPDATE incidents SET condition_active = false, ended_at = $2, updated_at = now()
       WHERE dedup_key = $1 AND status IN ('open','acknowledged') AND condition_active AND last_seen_at <= $2
       RETURNING id, status, recurrence`,
      [dedupKey, new Date(job.at)],
    );
    const rows: { id: string; status: string; recurrence: number }[] = result[0]; // for UPDATE, TypeORM returns [rows, count]
    for (const row of rows) {
      await this.eventRepository.insert({ incidentId: row.id, type: "condition_cleared", data: {} as any });
      this.events.emit(EVENTS.INCIDENT_UPDATED, { siteId: job.siteId, areaId: job.areaId, id: row.id, status: row.status, conditionActive: false, recurrence: row.recurrence });
    }
  }

  private title(job: RuleTransitionJob, lang: "en" | "bn") {
    const template = job.rule.i18n?.[lang]?.title ?? job.rule.i18n?.en?.title ?? job.rule.name;
    return template
      .replace("{zone}", job.zoneName ?? "")
      .replace("{camera}", job.cameraName)
      .replace("{subject}", lang === "en" ? `${(job.subjectName?.en ?? String(job.rule.params.subject ?? "")).toLowerCase()}s` : (job.subjectName?.bn ?? ""));
  }

  /** Share of this rule's incidents in the last 7 days that people marked as false alarms. Lowers the risk score. */
  private async falseAlarmRate(ruleId: string) {
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'false_alarm')::int AS fp
       FROM incidents WHERE rule_id = $1 AND created_at > now() - interval '7 days'`,
      [ruleId],
    );
    return row.total >= 3 ? row.fp / row.total : 0;
  }

  // =====================================================================
  // Called by people (controller)
  // =====================================================================

  async list(ctx: SiteContext, query: ListIncidentsDto) {
    const qb = this.incidentRepository.createQueryBuilder("i").where("i.siteId = :siteId", { siteId: ctx.site.id });
    if (query.status) qb.andWhere("i.status = :status", { status: query.status });
    if (query.severity) qb.andWhere("i.severity = :severity", { severity: query.severity });
    if (query.zoneId) qb.andWhere("i.zoneId = :zoneId", { zoneId: query.zoneId });
    if (query.cameraId) qb.andWhere("i.cameraId = :cameraId", { cameraId: query.cameraId });
    if (query.from) qb.andWhere("i.startedAt >= :from", { from: query.from });
    if (query.to) qb.andWhere("i.startedAt < :to", { to: query.to });
    if (query.q) qb.andWhere("i.search_tsv @@ plainto_tsquery('simple', :q)", { q: query.q }); // uses the GIN index
    if (ctx.areaIds !== null)
      qb.andWhere("i.cameraId IN (SELECT c.id FROM cameras c WHERE c.site_id = :siteId AND c.area_id = ANY(:areaIds))", { areaIds: ctx.areaIds });
    const [items, total] = await qb.orderBy("i.startedAt", "DESC").take(query.limit).skip(query.offset).getManyAndCount();
    return paged(items, total, query);
  }

  async getOne(ctx: SiteContext, incidentId: string) {
    const incident = await this.findOrFail(ctx, incidentId);
    const events = await this.eventRepository.find({ where: { incidentId }, order: { id: "ASC" } });
    return { ...incident, events };
  }

  async acknowledge(ctx: SiteContext, incidentId: string) {
    const incident = await this.findOrFail(ctx, incidentId);
    if (incident.status !== "open") throw new ConflictException(`Incident is already ${incident.status}`);
    await this.incidentRepository.update({ id: incidentId }, { status: "acknowledged", acknowledgedBy: ctx.member.id, acknowledgedAt: new Date() });
    await this.addEvent(ctx, incidentId, "acknowledged");
    // somebody is on it: stop the escalation of its alert (no phone calls after this)
    if (incident.alertId) await this.alerts.acknowledge(incident.alertId, ctx.member.id, "app");
    return this.changed(ctx, incidentId);
  }

  async resolve(ctx: SiteContext, incidentId: string, note?: string) {
    const incident = await this.findOrFail(ctx, incidentId);
    if (incident.status === "resolved" || incident.status === "false_alarm") throw new ConflictException(`Incident is already ${incident.status}`);
    await this.incidentRepository.update({ id: incidentId }, { status: "resolved", resolvedBy: ctx.member.id, resolvedAt: new Date(), resolutionNote: note ?? null });
    await this.addEvent(ctx, incidentId, "resolved", { note });
    await this.resetRuleState(incident.ruleId);
    if (incident.alertId) await this.alerts.acknowledge(incident.alertId, ctx.member.id, "app");
    return this.changed(ctx, incidentId);
  }

  /** "This was not real." Saved as training feedback, and it lowers the risk score of this rule's next incidents. */
  async falseAlarm(ctx: SiteContext, incidentId: string, dto: FalseAlarmDto) {
    const incident = await this.findOrFail(ctx, incidentId);
    if (incident.status === "false_alarm") throw new ConflictException("Incident is already marked as a false alarm");
    await this.incidentRepository.update({ id: incidentId }, { status: "false_alarm", falseAlarmReason: dto.reason, resolvedBy: ctx.member.id, resolvedAt: new Date(), resolutionNote: dto.note ?? null });
    await this.addEvent(ctx, incidentId, "false_alarm", { reason: dto.reason });
    await this.resetRuleState(incident.ruleId);
    await this.feedbackRepository.insert({
      siteId: ctx.site.id, incidentId, label: "false_positive", reason: dto.reason, detections: (incident.observed?.boxes ?? []) as any,
      createdBy: ctx.member.id, exportStatus: ctx.site.shareTrainingData ? "pending" : "excluded", // only shared with consent
    });
    if (incident.alertId) await this.alerts.acknowledge(incident.alertId, ctx.member.id, "app");
    const rate = incident.ruleId ? await this.falseAlarmRate(incident.ruleId) : 0;
    return {
      incident: await this.changed(ctx, incidentId),
      suggestion: rate >= 0.5 ? { ruleId: incident.ruleId, message: "More than half of this rule's incidents this week were false alarms. Consider a longer sustain time or a stricter limit." } : undefined,
    };
  }

  async reopen(ctx: SiteContext, incidentId: string) {
    const incident = await this.findOrFail(ctx, incidentId);
    if (incident.status === "open" || incident.status === "acknowledged") throw new ConflictException("Incident is not closed");
    try {
      await this.incidentRepository.update({ id: incidentId }, { status: "open", falseAlarmReason: null, resolvedBy: null, resolvedAt: null });
    } catch (error: any) {
      // the partial unique index: another open incident for the same thing already exists
      if (error?.code === "23505") throw new ConflictException("A newer open incident already covers this problem");
      throw error;
    }
    await this.addEvent(ctx, incidentId, "reopened");
    return this.changed(ctx, incidentId);
  }

  async addNote(ctx: SiteContext, incidentId: string, text: string) {
    await this.findOrFail(ctx, incidentId);
    return this.addEvent(ctx, incidentId, "note", { text });
  }

  async remove(ctx: SiteContext, incidentId: string) {
    await this.findOrFail(ctx, incidentId);
    await this.incidentRepository.delete({ id: incidentId });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "incident.delete", entityType: "incident", entityId: incidentId });
  }

  /** A link somebody without an account can open for a few hours (the police, a neighbour). */
  async share(ctx: SiteContext, incidentId: string, hours: number) {
    await this.findOrFail(ctx, incidentId);
    const expiresAt = Date.now() + hours * 3600_000;
    const token = signPayload({ i: incidentId, e: expiresAt }, appConfig.env.MEDIA_TOKEN_SECRET);
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "incident.share", entityType: "incident", entityId: incidentId, data: { hours } });
    return { url: `${appConfig.env.PUBLIC_API_URL}/v1/shared/incidents/${token}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  async shared(token: string) {
    const payload = verifyPayload<{ i: string; e: number }>(token, appConfig.env.MEDIA_TOKEN_SECRET);
    if (!payload || payload.e < Date.now()) throw new ForbiddenException("This link is invalid or has expired");
    const incident = await this.incidentRepository.findOne({ where: { id: payload.i } });
    if (!incident) throw new NotFoundException("Incident not found");
    return { title: incident.title, severity: incident.severity, status: incident.status, startedAt: incident.startedAt, endedAt: incident.endedAt, riskScore: incident.riskScore };
  }

  async findOrFail(ctx: SiteContext, incidentId: string) {
    const incident = await this.incidentRepository.findOne({ where: { id: incidentId, siteId: ctx.site.id } });
    if (!incident) throw new NotFoundException("Incident not found");
    if (ctx.areaIds !== null) {
      const [camera] = await this.dataSource.query(`SELECT area_id FROM cameras WHERE id = $1`, [incident.cameraId]);
      if (!camera || !ctx.areaIds.includes(camera.area_id))
        throw new ForbiddenException({ statusCode: 403, code: "outside_area_scope", message: "This is outside the areas you were given access to" });
    }
    return incident;
  }

  /**
   * A person closed the incident. The rule starts from "ok" again, so if the
   * problem is really still there it must last the full sustain time once more
   * and then opens a NEW incident (instead of staying silent for ever).
   */
  private async resetRuleState(ruleId: string | null) {
    if (ruleId) await this.redis.getClient().del(`rs:${ruleId}`);
  }

  private async addEvent(ctx: SiteContext, incidentId: string, type: IncidentEvent["type"], data: object = {}) {
    if (type === "note" && !(data as any).text) throw new BadRequestException("text is required");
    const saved = await this.eventRepository.save(this.eventRepository.create({ incidentId, type, actorMemberId: ctx.member.id, data }));
    return saved;
  }

  private async changed(ctx: SiteContext, incidentId: string) {
    const incident = await this.incidentRepository.findOneOrFail({ where: { id: incidentId } });
    this.events.emit(EVENTS.INCIDENT_UPDATED, { siteId: ctx.site.id, id: incident.id, status: incident.status, conditionActive: incident.conditionActive, recurrence: incident.recurrence });
    return incident;
  }
}
