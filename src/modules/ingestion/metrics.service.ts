import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";

interface Bucket { n: number; sum: number; min: number; max: number; sumsq: number }

/**
 * Counts over time. A camera sends a reading every second; storing each one
 * would fill the database with rows nobody reads. So:
 *   Redis    : one small summary per zone, metric and minute while the minute is open
 *   minutes  : written once per minute (table zone_metric_minutes, kept 48 hours)
 *   hours    : rolled up every hour (zone_metric_hours, kept 13 months)
 *   baseline : "what is normal for this hour of the week" (zone_baselines), rebuilt nightly
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly redis: RedisCacheService,
    private readonly dataSource: DataSource,
  ) {}

  /** Adds one sample to the open minute. */
  async record(siteId: string, zoneId: string, metric: string, value: number, atMs: number) {
    const client = this.redis.getClient();
    const minute = Math.floor(atMs / 60_000) * 60_000;
    const key = `mm:${minute}`;
    const field = `${siteId}|${zoneId}|${metric}`;
    const raw = await client.hGet(key, field);
    const b: Bucket = raw ? JSON.parse(raw) : { n: 0, sum: 0, min: value, max: value, sumsq: 0 };
    b.n += 1; b.sum += value; b.sumsq += value * value;
    b.min = Math.min(b.min, value); b.max = Math.max(b.max, value);
    await client.hSet(key, field, JSON.stringify(b));
    await client.zAdd("mm:index", { score: minute, value: key });
  }

  /** Moves finished minutes from Redis into zone_metric_minutes. force = also the minute still open. */
  async flushMinutes(force = false) {
    const client = this.redis.getClient();
    const currentMinute = Math.floor(Date.now() / 60_000) * 60_000;
    // Simulators replay other dates, so "finished" means: not touched for a minute, or force.
    const keys = await client.zRange("mm:index", 0, -1);
    let rows = 0;
    for (const key of keys) {
      const minute = Number(key.slice(3));
      if (!force && minute >= currentMinute) continue;
      const fields = await client.hGetAll(key);
      for (const [field, raw] of Object.entries(fields)) {
        const [siteId, zoneId, metric] = field.split("|");
        const b: Bucket = JSON.parse(raw);
        try {
          await this.dataSource.query(
            `INSERT INTO zone_metric_minutes (site_id, zone_id, metric_key, bucket, n, sum, min, max, sumsq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (zone_id, metric_key, bucket) DO UPDATE SET
               n = zone_metric_minutes.n + EXCLUDED.n, sum = zone_metric_minutes.sum + EXCLUDED.sum,
               sumsq = zone_metric_minutes.sumsq + EXCLUDED.sumsq,
               min = LEAST(zone_metric_minutes.min, EXCLUDED.min), max = GREATEST(zone_metric_minutes.max, EXCLUDED.max)`,
            [siteId, zoneId, metric, new Date(minute), Math.min(b.n, 32767), b.sum, b.min, b.max, b.sumsq],
          );
          rows++;
        } catch (error: any) {
          if (error?.code !== "23503") this.logger.error(`minute flush failed: ${error}`); // 23503 = the zone was deleted meanwhile
        }
      }
      await client.del(key);
      await client.zRem("mm:index", key);
    }
    return { minuteRowsWritten: rows };
  }

  /** Builds hour rows from minute rows. Recomputing an hour gives the same row, so it is safe to run twice. */
  async rollupHours(sinceHours = 3) {
    const result = await this.dataSource.query(
      `INSERT INTO zone_metric_hours (site_id, zone_id, metric_key, bucket, n, sum, min, max, sumsq)
       SELECT site_id, zone_id, metric_key, date_trunc('hour', bucket), sum(n)::int, sum(sum), min(min), max(max), sum(sumsq)
       FROM zone_metric_minutes WHERE bucket >= now() - make_interval(hours => $1)
       GROUP BY site_id, zone_id, metric_key, date_trunc('hour', bucket)
       ON CONFLICT (zone_id, metric_key, bucket) DO UPDATE SET
         n = EXCLUDED.n, sum = EXCLUDED.sum, min = EXCLUDED.min, max = EXCLUDED.max, sumsq = EXCLUDED.sumsq
       RETURNING 1`,
      [sinceHours],
    );
    return { hourRows: result.length };
  }

  /**
   * "Normal" for each zone, metric and hour of the week (0 = Monday 00:00 site time),
   * from the last 8 weeks of hourly averages. Median and MAD are used instead of
   * mean and standard deviation because one strange day must not move the baseline.
   */
  async rebuildBaselines() {
    const result = await this.dataSource.query(
      `WITH hourly AS (
         SELECT h.zone_id, h.metric_key,
                ((extract(isodow FROM h.bucket AT TIME ZONE s.timezone)::int - 1) * 24
                  + extract(hour FROM h.bucket AT TIME ZONE s.timezone)::int) AS how,
                h.sum / NULLIF(h.n, 0) AS value
         FROM zone_metric_hours h JOIN sites s ON s.id = h.site_id
         WHERE h.bucket >= now() - interval '8 weeks' AND h.n > 0
       ), med AS (
         SELECT zone_id, metric_key, how, count(*) AS n_weeks,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS median, avg(value) AS mean,
                coalesce(stddev_pop(value), 0) AS std
         FROM hourly GROUP BY zone_id, metric_key, how
       ), mad AS (
         SELECT h.zone_id, h.metric_key, h.how,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(h.value - m.median)) AS mad
         FROM hourly h JOIN med m USING (zone_id, metric_key, how) GROUP BY h.zone_id, h.metric_key, h.how
       )
       INSERT INTO zone_baselines (zone_id, metric_key, hour_of_week, n_weeks, median, mad, mean, std, updated_at)
       SELECT m.zone_id, m.metric_key, m.how, m.n_weeks, m.median, d.mad, m.mean, m.std, now()
       FROM med m JOIN mad d USING (zone_id, metric_key, how)
       ON CONFLICT (zone_id, metric_key, hour_of_week) DO UPDATE SET
         n_weeks = EXCLUDED.n_weeks, median = EXCLUDED.median, mad = EXCLUDED.mad, mean = EXCLUDED.mean,
         std = EXCLUDED.std, updated_at = now()
       RETURNING 1`,
    );
    await this.dropBaselineCache();
    return { baselineRows: result.length };
  }

  /** Cached 10 minutes: the anomaly rule asks for it on every reading. */
  async baseline(zoneId: string, metric: string, hourOfWeek: number) {
    const client = this.redis.getClient();
    const key = `base:${zoneId}:${metric}:${hourOfWeek}`;
    const cached = await client.get(key);
    if (cached) return cached === "none" ? null : (JSON.parse(cached) as { median: number; mad: number; nWeeks: number });
    const [row] = await this.dataSource.query(
      `SELECT median, mad, n_weeks AS "nWeeks" FROM zone_baselines WHERE zone_id = $1 AND metric_key = $2 AND hour_of_week = $3`,
      [zoneId, metric, hourOfWeek],
    );
    await client.set(key, row ? JSON.stringify(row) : "none", { EX: 600 });
    return row ?? null;
  }

  private async dropBaselineCache() {
    const client = this.redis.getClient();
    const keys = await client.keys("base:*");
    if (keys.length) await client.del(keys);
  }

  // ---- reading (charts) ----

  points(zoneId: string, metric: string, from: Date, to: Date, step: "minute" | "hour") {
    const table = step === "hour" ? "zone_metric_hours" : "zone_metric_minutes";
    return this.dataSource.query(
      `SELECT bucket AS t, round((sum / NULLIF(n, 0))::numeric, 2)::float AS avg, min, max, n
       FROM ${table} WHERE zone_id = $1 AND metric_key = $2 AND bucket >= $3 AND bucket < $4 ORDER BY bucket LIMIT 2000`,
      [zoneId, metric, from, to],
    );
  }

  baselineCurve(zoneId: string, metric: string) {
    return this.dataSource.query(
      `SELECT hour_of_week AS "hourOfWeek", median, mad, n_weeks AS "nWeeks" FROM zone_baselines
       WHERE zone_id = $1 AND metric_key = $2 ORDER BY hour_of_week`,
      [zoneId, metric],
    );
  }
}
