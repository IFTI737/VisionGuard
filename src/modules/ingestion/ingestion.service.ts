import { EVENTS } from "@/common/constants/events";
import type { Detection, RuleRuntimeState } from "@/common/contracts";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { inZone, Sample, stepRule } from "@/modules/engine/core/engine";
import { evaluateRule, EvalResult, ZoneFrame } from "@/modules/engine/core/evaluate";
import { hourOfWeek, isWithinSchedule } from "@/modules/engine/core/schedule";
import { ReadingInput } from "@/modules/ingestion/dto/readings.dto";
import { MetricsService } from "@/modules/ingestion/metrics.service";
import { CameraRuntime, RuleRuntime, RuntimeConfigService, ZoneRuntime } from "@/modules/ingestion/runtime-config.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { InjectQueue } from "@nestjs/bull";
import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bull";
import { Repository } from "typeorm";

/** What the incident worker receives when a rule fires or clears. */
export interface RuleTransitionJob {
  type: "fire" | "refire" | "clear";
  at: number; // epoch ms, device time
  siteId: string; siteName: string; timezone: string; sensitivity: 1 | 2 | 3;
  areaId: string; cameraId: string; cameraName: string;
  zoneId: string | null; zoneName: string | null;
  rule: RuleRuntime;
  subjectName: { en: string; bn: string } | null; // readable name of the rule's subject ("Cow" / "গরু")
  result: EvalResult | null;
  counts: Record<string, number>;
  state: RuleRuntimeState;
}

const MAX_AGE_MS = 5 * 60_000; // a live device may not send readings older than this
const SAMPLE_KEEP_S = 3600; // longest window any rule may ask for

/**
 * The heart of the backend. An AI model only says "I see 9 cows, here are the boxes".
 * This service turns that into meaning:
 *   reading -> which zone is each box in -> counts per zone -> each rule: violated or not
 *           -> the state machine decides when it is a real problem (not one bad frame)
 *           -> a job for the incident worker.
 * Live state lives in Redis; PostgreSQL only gets minute summaries and incidents.
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly runtime: RuntimeConfigService,
    private readonly metrics: MetricsService,
    private readonly redis: RedisCacheService,
    private readonly events: EventEmitter2,
    @InjectQueue(QUEUE.INCIDENT) private readonly incidentQueue: Queue,
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
  ) {}

  async ingest(device: Device, readings: ReadingInput[]) {
    const rejected: { seq: number; cameraId: string; reason: string }[] = [];
    let accepted = 0;
    // oldest first, so the state machine sees time moving forward
    for (const reading of [...readings].sort((a, b) => a.seq - b.seq)) {
      const reason = await this.ingestOne(device, reading);
      if (reason) rejected.push({ seq: reading.seq, cameraId: reading.cameraId, reason });
      else accepted++;
    }
    const fresh = await this.deviceRepository.findOne({ where: { id: device.id } });
    return { accepted, rejected, configVersion: fresh?.configVersion ?? device.configVersion, serverTime: new Date().toISOString() };
  }

  private async ingestOne(device: Device, reading: ReadingInput): Promise<string | null> {
    const client = this.redis.getClient();
    const rt = await this.runtime.forCamera(reading.cameraId);
    // a device may only speak for its own cameras
    if (!rt || rt.siteId !== device.siteId || rt.deviceId !== device.id) return "unknown_camera";
    if (rt.siteStatus !== "active") return "invalid";

    // 1. duplicates: a device that retries after a bad connection must not count things twice
    const seqKey = `seq:${reading.cameraId}`;
    const lastSeq = Number((await client.get(seqKey)) ?? -1);
    if (reading.seq <= lastSeq) return "duplicate";

    // 2. time: a simulator replays recorded time ("event"), real devices are checked against the server clock
    const captured = Date.parse(reading.capturedAt);
    if (device.timeMode === "wall" && Date.now() - captured > MAX_AGE_MS) return "too_old";
    const now = device.timeMode === "wall" ? Math.min(captured, Date.now()) : captured;
    await client.set(seqKey, String(reading.seq), { EX: 86400 });

    await this.markSeen(rt);
    const paused = !!rt.pausedUntil && Date.parse(rt.pausedUntil) > now;

    // 3. camera-level rules (camera covered or moved)
    for (const rule of rt.cameraRules) {
      const frame: ZoneFrame = { now, dets: [], counts: {}, measures: {}, samples: {}, frameStats: reading.frameStats };
      await this.runRule(rt, null, rule, frame, paused);
    }

    // 4. zone by zone
    for (const zone of rt.zones) {
      const dets = (reading.detections as Detection[]).filter((d) => inZone(zone.polygon, d.box, zone.anchor, zone.minOverlap));
      const counts: Record<string, number> = {};
      for (const d of dets) {
        counts[d.cls] = (counts[d.cls] ?? 0) + 1;
        const parent = rt.parents[d.cls];
        if (parent) counts[parent] = (counts[parent] ?? 0) + 1; // a cow is also an animal
      }
      const measures: Record<string, number> = {};
      for (const m of reading.measures ?? []) if (m.zoneId === zone.id) measures[m.key] = m.value;

      const samples = await this.updateSamples(rt.siteId, zone, counts, measures, now);
      const frame: ZoneFrame = { now, dets, counts, measures, samples, frameStats: reading.frameStats };
      const zoneMuted = !!zone.mutedUntil && Date.parse(zone.mutedUntil) > now;
      const ruleStates: { ruleId: string; state: string }[] = [];
      for (const rule of zone.rules) ruleStates.push({ ruleId: rule.id, state: await this.runRule(rt, zone, rule, frame, paused || zoneMuted) });

      // 5. live state for the dashboard
      const live = { zoneId: zone.id, at: new Date(now).toISOString(), counts, measures, rules: ruleStates };
      await client.hSet(`zs:${rt.siteId}`, zone.id, JSON.stringify(live));
      this.events.emit(EVENTS.ZONE_STATE, { siteId: rt.siteId, areaId: rt.areaId, ...live });
    }
    return null;
  }

  /** Remembers recent values per metric (for "highest count in the last minute") and feeds the minute summaries. */
  private async updateSamples(siteId: string, zone: ZoneRuntime, counts: Record<string, number>, measures: Record<string, number>, now: number) {
    const client = this.redis.getClient();
    const key = `zw:${zone.id}`;
    const raw = await client.get(key);
    const samples: Record<string, Sample[]> = raw ? JSON.parse(raw) : {};
    const values: Record<string, number> = {};
    // a class the rules need but nobody saw is a real 0, not "no data"
    for (const metric of zone.metrics) if (metric.startsWith("count.")) values[metric] = counts[metric.slice(6)] ?? 0;
    for (const [cls, n] of Object.entries(counts)) values[`count.${cls}`] = n;
    for (const [k, v] of Object.entries(measures)) values[`measure.${k}`] = v;

    for (const [metric, value] of Object.entries(values)) {
      const list = (samples[metric] ?? []).filter((s) => now - s.t <= SAMPLE_KEEP_S * 1000 && s.t <= now);
      list.push({ t: now, v: value });
      samples[metric] = list.slice(-600);
      await this.metrics.record(siteId, zone.id, metric, value, now);
    }
    await client.set(key, JSON.stringify(samples), { EX: 2 * SAMPLE_KEEP_S });
    return samples;
  }

  /** Evaluates one rule, moves its state machine one step, and queues a job on fire / refire / clear. */
  private async runRule(rt: CameraRuntime, zone: ZoneRuntime | null, rule: RuleRuntime, frame: ZoneFrame, silenced: boolean): Promise<string> {
    const client = this.redis.getClient();
    const key = `rs:${rule.id}`;
    const raw = await client.get(key);
    const state: RuleRuntimeState = raw ? JSON.parse(raw) : { state: "ok", samples: 0, violating: 0 };

    const muted = !!rule.mutedUntil && Date.parse(rule.mutedUntil) > frame.now;
    const active = !silenced && !muted && isWithinSchedule(rule.schedule, frame.now, rt.timezone);
    const wasViolating = state.state === "pending" || state.state === "firing";
    let result: EvalResult | null = null;
    if (active) {
      const baseline = rule.kind === "anomaly" && zone ? await this.metrics.baseline(zone.id, rule.params.metric, hourOfWeek(frame.now, rt.timezone)) : null;
      result = evaluateRule(rule.kind, rule.params, frame, { wasViolating, sensitivity: rt.sensitivity, baseline }, rt.parents);
      if (result === null) return state.state; // this reading says nothing about this rule
    }
    const violating = active && !!result?.violating;

    const step = stepRule(state, violating, frame.now, { sustainS: rule.sustainS, clearS: rule.clearS, cooldownS: rule.cooldownS });
    const next = step.state;
    if (violating && result) next.peak = Math.max(next.peak ?? 0, Math.abs(result.value));
    await client.set(key, JSON.stringify(next), { EX: 86400 });

    if (step.transition === "fire" || step.transition === "refire" || step.transition === "clear") {
      const job: RuleTransitionJob = {
        type: step.transition, at: frame.now,
        siteId: rt.siteId, siteName: rt.siteName, timezone: rt.timezone, sensitivity: rt.sensitivity,
        areaId: rt.areaId, cameraId: rt.cameraId, cameraName: rt.cameraName,
        zoneId: zone?.id ?? null, zoneName: zone?.name ?? null,
        rule, subjectName: rt.names[rule.params.subject] ?? null, result, counts: frame.counts, state: next,
      };
      await this.incidentQueue.add("transition", job, { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: true });
    }
    return next.state;
  }

  /** Any reading or heartbeat proves the camera is alive. */
  async markSeen(rt: CameraRuntime) {
    await this.redis.getClient().hSet("cam:seen", rt.cameraId, String(Date.now()));
    if (rt.status !== "online") {
      await this.cameraRepository.update({ id: rt.cameraId }, { status: "online", lastSeenAt: new Date() });
      await this.runtime.dropCamera(rt.cameraId);
      this.events.emit(EVENTS.CAMERA_STATUS, { siteId: rt.siteId, areaId: rt.areaId, cameraId: rt.cameraId, status: "online", at: new Date().toISOString() });
      // if it was reported offline, that incident's condition is over
      const offlineRule = rt.cameraRules.find((r) => r.kind === "device_health" && r.params.check === "offline");
      if (offlineRule) await this.queueOffline(rt, offlineRule, "clear");
    }
  }

  /** Used by the sweeper job when a camera has been silent too long, and by markSeen when it returns. */
  async queueOffline(rt: CameraRuntime, rule: RuleRuntime, type: "fire" | "clear") {
    const now = Date.now();
    const job: RuleTransitionJob = {
      type, at: now, siteId: rt.siteId, siteName: rt.siteName, timezone: rt.timezone, sensitivity: rt.sensitivity,
      areaId: rt.areaId, cameraId: rt.cameraId, cameraName: rt.cameraName, zoneId: null, zoneName: null, rule, subjectName: null,
      result: { violating: type === "fire", value: 1, unit: "seconds", magnitude: 0.5, subject: "offline", boxes: [], avgConf: 1 },
      counts: {}, state: { state: type === "fire" ? "firing" : "ok", samples: 1, violating: 1, firstViolatedAt: now, lastViolatedAt: now },
    };
    await this.incidentQueue.add("transition", job, { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: true });
  }

  /** Live counts per zone, straight from Redis (no database query). */
  async liveState(siteId: string) {
    const all = await this.redis.getClient().hGetAll(`zs:${siteId}`);
    return Object.values(all).map((raw) => JSON.parse(raw));
  }
}
