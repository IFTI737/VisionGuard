import { EVENTS } from "@/common/constants/events";
import { BillingService } from "@/modules/billing/billing.service";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { MetricsService } from "@/modules/ingestion/metrics.service";
import { RuntimeConfigService } from "@/modules/ingestion/runtime-config.service";
import { MediaService } from "@/modules/media/media.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource } from "typeorm";

/** Every background task, with how often it runs. "every" is milliseconds, "cron" is a cron line. */
export const TASKS = {
  "flush-metrics": { every: 60_000 }, // Redis minute summaries -> zone_metric_minutes
  "camera-sweep": { every: 30_000 }, // cameras that went silent -> offline
  "site-resume": { every: 60_000 }, // paused sites whose time is up -> armed
  "rollup-hours": { cron: "5 * * * *" }, // minutes -> hours
  "billing": { cron: "0 1 * * *" }, // renew periods, issue invoices, mark past due
  "baselines": { cron: "10 2 * * *" }, // "what is normal" per hour of the week
  "partitions": { cron: "30 3 * * *" }, // tomorrow's minute partition; drop old ones
  "retention": { cron: "45 3 * * *" }, // old video, old incidents, expired files
  "cleanup": { cron: "0 4 * * *" }, // old audit rows, expired tokens and codes
} as const;
export type TaskName = keyof typeof TASKS;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisCacheService,
    private readonly metrics: MetricsService,
    private readonly runtime: RuntimeConfigService,
    private readonly ingestion: IngestionService,
    private readonly billing: BillingService,
    private readonly media: MediaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Runs one task by name. Used by the queue worker on schedule and by the dev endpoint on demand. */
  async run(task: string, options: Record<string, any> = {}) {
    switch (task as TaskName) {
      case "flush-metrics": return this.metrics.flushMinutes(!!options.force);
      case "rollup-hours": return this.metrics.rollupHours(options.sinceHours ?? 3);
      case "baselines": return this.metrics.rebuildBaselines();
      case "camera-sweep": return this.cameraSweep(options.offlineAfterS);
      case "site-resume": return this.resumePausedSites();
      case "billing": return { renewed: await this.billing.renewDue(), pastDue: await this.billing.markPastDue() };
      case "partitions": return this.partitions();
      case "retention": return this.retention();
      case "cleanup": return this.cleanup();
      default: throw new BadRequestException(`Unknown task "${task}". Tasks: ${Object.keys(TASKS).join(", ")}`);
    }
  }

  /**
   * A camera that sent nothing for longer than its "offline" rule allows
   * (default 90 seconds) is marked offline and gets a "Camera offline" incident.
   */
  private async cameraSweep(overrideS?: number) {
    const client = this.redis.getClient();
    const online = await this.dataSource.query(
      `SELECT c.id, d.kind AS "deviceKind" FROM cameras c LEFT JOIN devices d ON d.id = c.device_id WHERE c.status = 'online' AND c.deleted_at IS NULL`,
    );
    let wentOffline = 0;
    for (const { id, deviceKind } of online) {
      // a simulator replays recorded time, so real-clock silence means nothing for it (unless asked for by hand)
      if (deviceKind === "simulator" && overrideS === undefined) continue;
      const rt = await this.runtime.forCamera(id);
      if (!rt) continue;
      const rule = rt.cameraRules.find((r) => r.kind === "device_health" && r.params.check === "offline");
      const limitS = overrideS ?? rule?.params.offlineS ?? 90;
      const seen = Number((await client.hGet("cam:seen", id)) ?? 0);
      if (Date.now() - seen <= limitS * 1000) continue;
      await this.dataSource.query(`UPDATE cameras SET status = 'offline' WHERE id = $1`, [id]);
      await this.runtime.dropCamera(id);
      this.events.emit(EVENTS.CAMERA_STATUS, { siteId: rt.siteId, areaId: rt.areaId, cameraId: id, status: "offline", at: new Date().toISOString() });
      if (rule) await this.ingestion.queueOffline(rt, rule, "fire");
      wentOffline++;
    }
    return { checked: online.length, wentOffline };
  }

  private async resumePausedSites() {
    const rows = await this.dataSource.query(`UPDATE sites SET mode = 'armed', paused_until = NULL WHERE mode = 'paused' AND paused_until < now() RETURNING id`);
    const resumed = Array.isArray(rows[0]) ? rows[0] : rows; // pg returns [rows, count] for UPDATE ... RETURNING
    for (const row of resumed) this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: row.id });
    return { resumed: resumed.length };
  }

  private async partitions() {
    await this.dataSource.query(`SELECT vg_ensure_minute_partition(current_date + d) FROM generate_series(0, 3) AS d`);
    // minute data is kept 48 hours; dropping a whole partition is instant
    const old = await this.dataSource.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
       WHERE p.relname = 'zone_metric_minutes' AND c.relname ~ '^zone_metric_minutes_[0-9]{8}$'
         AND to_date(right(c.relname, 8), 'YYYYMMDD') < current_date - 2`,
    );
    for (const { relname } of old) await this.dataSource.query(`DROP TABLE IF EXISTS "${relname}"`);
    const [fallback] = await this.dataSource.query(`SELECT count(*)::int AS n FROM zone_metric_minutes_default`);
    if (fallback.n > 0) this.logger.warn(`zone_metric_minutes_default holds ${fallback.n} rows (simulator data with other dates, or a missed partition day)`);
    return { ensuredDaysAhead: 3, dropped: old.length, defaultPartitionRows: fallback.n };
  }

  private async retention() {
    const segments = await this.media.purgeOldSegments();
    const hours = await this.dataSource.query(`DELETE FROM zone_metric_hours WHERE bucket < now() - interval '13 months'`);
    const incidents = await this.dataSource.query(
      `DELETE FROM incidents i USING subscriptions s, plans p
       WHERE s.site_id = i.site_id AND p.id = s.plan_id AND i.status IN ('resolved','false_alarm')
         AND i.created_at < now() - make_interval(days => p.incident_retention_days)`,
    );
    return { ...segments, hourRowsDeleted: hours[1] ?? 0, incidentsDeleted: incidents[1] ?? 0 };
  }

  private async cleanup() {
    // in batches, so the delete never holds a long lock
    let audit = 0;
    for (;;) {
      const result = await this.dataSource.query(`DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < now() - interval '12 months' LIMIT 5000)`);
      const n = result[1] ?? 0;
      audit += n;
      if (n < 5000) break;
    }
    const tokens = await this.dataSource.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
    const codes = await this.dataSource.query(`DELETE FROM auth_codes WHERE created_at < now() - interval '1 day'`);
    return { auditRowsDeleted: audit, refreshTokensDeleted: tokens[1] ?? 0, codesDeleted: codes[1] ?? 0 };
  }
}
