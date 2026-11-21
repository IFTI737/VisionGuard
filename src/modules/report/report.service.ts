import { EVENTS } from "@/common/constants/events";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { MediaService } from "@/modules/media/media.service";
import { CreateExportDto } from "@/modules/report/dto/report.dto";
import { ExportJob } from "@/modules/report/entities/export-job.entity";
import { QUEUE } from "@/providers/queue/redis/queues";
import { InjectQueue } from "@nestjs/bull";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bull";
import { DataSource, Repository } from "typeorm";

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(ExportJob) private readonly exportRepository: Repository<ExportJob>,
    @InjectQueue(QUEUE.EXPORT) private readonly exportQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly ingestion: IngestionService,
    private readonly media: MediaService,
    private readonly events: EventEmitter2,
  ) {}

  /** The first screen of the dashboard: what is happening on this site right now. */
  async overview(ctx: SiteContext) {
    const siteId = ctx.site.id;
    const areaFilter = ctx.areaIds === null ? "" : "AND c.area_id = ANY($2)";
    const params = ctx.areaIds === null ? [siteId] : [siteId, ctx.areaIds];
    const cameras = await this.dataSource.query(`SELECT c.id, c.name, c.status, c.last_seen_at AS "lastSeenAt" FROM cameras c WHERE c.site_id = $1 AND c.deleted_at IS NULL ${areaFilter} ORDER BY c.created_at`, params);
    const openIncidents = await this.dataSource.query(
      `SELECT i.id, i.title, i.severity, i.risk_score AS "riskScore", i.status, i.condition_active AS "conditionActive", i.started_at AS "startedAt"
       FROM incidents i LEFT JOIN cameras c ON c.id = i.camera_id
       WHERE i.site_id = $1 AND i.status IN ('open','acknowledged') ${areaFilter} ORDER BY i.risk_score DESC, i.started_at DESC LIMIT 10`,
      params,
    );
    const [activeAlert] = await this.dataSource.query(`SELECT id, title, severity, current_step AS "currentStep", created_at AS "createdAt" FROM alerts WHERE site_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [siteId]);
    const cameraIds = new Set(cameras.map((c: any) => c.id));
    const zones = await this.dataSource.query(`SELECT id, camera_id FROM zones WHERE site_id = $1 AND deleted_at IS NULL`, [siteId]);
    const allowedZones = new Set(zones.filter((z: any) => cameraIds.has(z.camera_id)).map((z: any) => z.id));
    const live = (await this.ingestion.liveState(siteId)).filter((s) => allowedZones.has(s.zoneId));
    return { site: { id: ctx.site.id, name: ctx.site.name, mode: ctx.site.mode, pausedUntil: ctx.site.pausedUntil }, cameras, live, openIncidents, activeAlert: activeAlert ?? null };
  }

  /** Numbers for the last N days: how many incidents, how many were false alarms, how fast people reacted. */
  async summary(siteId: string, days: number) {
    const [incidents] = await this.dataSource.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'false_alarm')::int AS "falseAlarms",
              count(*) FILTER (WHERE status IN ('open','acknowledged'))::int AS "stillOpen",
              round(avg(extract(epoch FROM (acknowledged_at - started_at))) FILTER (WHERE acknowledged_at IS NOT NULL))::int AS "avgSecondsToAcknowledge"
       FROM incidents WHERE site_id = $1 AND created_at > now() - make_interval(days => $2)`,
      [siteId, days],
    );
    const bySeverity = await this.dataSource.query(`SELECT severity, count(*)::int AS n FROM incidents WHERE site_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY severity`, [siteId, days]);
    const byKind = await this.dataSource.query(`SELECT kind, count(*)::int AS n FROM incidents WHERE site_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY kind ORDER BY n DESC`, [siteId, days]);
    const alerts = await this.dataSource.query(`SELECT status, count(*)::int AS n FROM alerts WHERE site_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY status`, [siteId, days]);
    return { days, incidents, bySeverity, byKind, alerts };
  }

  /** One search box: incidents by words in the title or note, cameras and zones by name. */
  async search(ctx: SiteContext, q: string) {
    if (!q || q.trim().length < 2) throw new BadRequestException("q must be at least 2 characters");
    const scope = ctx.areaIds === null ? "" : "AND c.area_id = ANY($3)";
    const params = (first: string) => (ctx.areaIds === null ? [ctx.site.id, first] : [ctx.site.id, first, ctx.areaIds]);
    const incidents = await this.dataSource.query(
      `SELECT i.id, i.title, i.status, i.started_at AS "startedAt" FROM incidents i LEFT JOIN cameras c ON c.id = i.camera_id
       WHERE i.site_id = $1 AND i.search_tsv @@ plainto_tsquery('simple', $2) ${scope} ORDER BY i.started_at DESC LIMIT 20`,
      params(q),
    );
    const cameras = await this.dataSource.query(`SELECT c.id, c.name, c.status FROM cameras c WHERE c.site_id = $1 AND c.deleted_at IS NULL AND c.name ILIKE $2 ${scope} LIMIT 20`, params(`%${q}%`));
    const zones = await this.dataSource.query(`SELECT z.id, z.name, z.camera_id AS "cameraId" FROM zones z JOIN cameras c ON c.id = z.camera_id WHERE z.site_id = $1 AND z.deleted_at IS NULL AND z.name ILIKE $2 ${scope} LIMIT 20`, params(`%${q}%`));
    return { incidents, cameras, zones };
  }

  // ---------------- CSV exports (made by a queue worker) ----------------

  async requestExport(ctx: SiteContext, dto: CreateExportDto) {
    const job = await this.exportRepository.save(
      this.exportRepository.create({ siteId: ctx.site.id, requestedBy: ctx.member.id, reportType: dto.reportType, format: dto.format, params: { from: dto.from, to: dto.to } }),
    );
    await this.exportQueue.add("build", { exportId: job.id }, { attempts: 2, removeOnComplete: true });
    return job;
  }

  listExports(ctx: SiteContext) {
    return this.exportRepository.find({ where: { siteId: ctx.site.id, requestedBy: ctx.member.id }, order: { createdAt: "DESC" }, take: 20 });
  }

  async getExport(ctx: SiteContext, exportId: string) {
    const job = await this.exportRepository.findOne({ where: { id: exportId, siteId: ctx.site.id } });
    if (!job) throw new NotFoundException("Export not found");
    return { ...job, download: job.status === "ready" && job.mediaId ? this.media.signedUrl(job.mediaId) : null };
  }

  /** Runs in the "export" queue worker. */
  async buildExport(exportId: string) {
    const job = await this.exportRepository.findOne({ where: { id: exportId } });
    if (!job || job.status !== "queued") return;
    await this.exportRepository.update({ id: exportId }, { status: "running" });
    try {
      const from = job.params?.from ? new Date(job.params.from) : new Date(Date.now() - 30 * 86400_000);
      const to = job.params?.to ? new Date(job.params.to) : new Date(Date.now() + 86400_000);
      const rows: Record<string, unknown>[] =
        job.reportType === "incidents"
          ? await this.dataSource.query(
              `SELECT started_at, ended_at, title, kind, severity, risk_score, status, recurrence, false_alarm_reason, resolution_note
               FROM incidents WHERE site_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at`, [job.siteId, from, to])
          : await this.dataSource.query(
              `SELECT created_at, title, source, severity, status, current_step, acknowledged_via, acknowledged_at
               FROM alerts WHERE site_id = $1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at`, [job.siteId, from, to]);
      const header = rows.length ? Object.keys(rows[0]) : ["no rows in this period"];
      const csv = [header.join(","), ...rows.map((row) => header.map((h) => csvCell(row[h])).join(","))].join("\n");
      const expiresAt = new Date(Date.now() + 7 * 86400_000);
      const media = await this.media.store(job.siteId, "file", "exports", "csv", "text/csv", Buffer.from("﻿" + csv, "utf8"), expiresAt); // BOM: Excel shows Bangla correctly
      await this.exportRepository.update({ id: exportId }, { status: "ready", mediaId: media.id, finishedAt: new Date(), expiresAt });
      this.events.emit(EVENTS.EXPORT_READY, { siteId: job.siteId, id: exportId });
    } catch (error: any) {
      await this.exportRepository.update({ id: exportId }, { status: "failed", error: String(error?.message ?? error).slice(0, 300), finishedAt: new Date() });
    }
  }
}
