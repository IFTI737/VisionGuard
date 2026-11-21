import { EVENTS } from "@/common/constants/events";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { ObjectClass } from "@/modules/catalog/entities/object-class.entity";
import { RuleTemplate } from "@/modules/catalog/entities/rule-template.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { Rule } from "@/modules/rule/entities/rule.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

export interface RuleRuntime {
  id: string; name: string; kind: string; templateCode: string; params: any; severity: "low" | "medium" | "high" | "critical";
  schedule: any | null; sustainS: number; clearS: number; cooldownS: number; mutedUntil: string | null; version: number;
  i18n: { en?: { title?: string }; bn?: { title?: string } };
}
export interface ZoneRuntime {
  id: string; name: string; polygon: [number, number][]; anchor: "foot" | "center" | "overlap"; minOverlap: number;
  mutedUntil: string | null; rules: RuleRuntime[]; metrics: string[];
}
export interface CameraRuntime {
  siteId: string; siteName: string; timezone: string; sensitivity: 1 | 2 | 3; siteStatus: string; pausedUntil: string | null;
  cameraId: string; cameraName: string; deviceId: string | null; areaId: string; status: string;
  zones: ZoneRuntime[]; cameraRules: RuleRuntime[]; parents: Record<string, string | null>;
  names: Record<string, { en: string; bn: string }>; // class code -> readable name, for incident titles
}

const TTL_S = 300;

/**
 * Everything the engine needs to judge one camera's readings, in one cached
 * JSON document: its zones, their rules, the site's settings.
 * Readings arrive every second; this avoids five database queries per reading.
 * Any change to cameras, zones or rules emits "config.changed", which drops the cache.
 */
@Injectable()
export class RuntimeConfigService {
  constructor(
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(Zone) private readonly zoneRepository: Repository<Zone>,
    @InjectRepository(Rule) private readonly ruleRepository: Repository<Rule>,
    @InjectRepository(RuleTemplate) private readonly templateRepository: Repository<RuleTemplate>,
    @InjectRepository(Site) private readonly siteRepository: Repository<Site>,
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
    @InjectRepository(ObjectClass) private readonly classRepository: Repository<ObjectClass>,
    private readonly redis: RedisCacheService,
  ) {}

  async forCamera(cameraId: string): Promise<CameraRuntime | null> {
    const key = `rt:cam:${cameraId}`;
    const cached = await this.redis.getClient().get(key);
    if (cached) return JSON.parse(cached);

    const camera = await this.cameraRepository.findOne({ where: { id: cameraId } });
    if (!camera) return null;
    const site = await this.siteRepository.findOne({ where: { id: camera.siteId } });
    if (!site) return null;
    const zones = await this.zoneRepository.find({ where: { cameraId, enabled: true } });
    const rules = (await this.ruleRepository.find({ where: { siteId: site.id, enabled: true } })).filter(
      (r) => r.cameraId === cameraId || zones.some((z) => z.id === r.zoneId),
    );
    const templates = await this.templateRepository.find();
    const classes = await this.classRepository.find();

    const toRuntime = (rule: Rule): RuleRuntime => {
      const template = templates.find((t) => t.id === rule.templateId)!;
      return {
        id: rule.id, name: rule.name, kind: template.kind, templateCode: template.code, params: rule.params, severity: rule.severity,
        schedule: rule.schedule, sustainS: rule.sustainS, clearS: rule.clearS, cooldownS: rule.cooldownS,
        mutedUntil: rule.mutedUntil ? rule.mutedUntil.toISOString() : null, version: rule.version, i18n: template.i18n ?? {},
      };
    };
    const runtime: CameraRuntime = {
      siteId: site.id, siteName: site.name, timezone: site.timezone, sensitivity: site.sensitivity as 1 | 2 | 3, siteStatus: site.status,
      pausedUntil: site.mode === "paused" && site.pausedUntil ? site.pausedUntil.toISOString() : null,
      cameraId: camera.id, cameraName: camera.name, deviceId: camera.deviceId, areaId: camera.areaId, status: camera.status,
      zones: zones.map((zone) => {
        const zoneRules = rules.filter((r) => r.zoneId === zone.id).map(toRuntime);
        return {
          id: zone.id, name: zone.name, polygon: zone.polygon, anchor: zone.anchor, minOverlap: zone.minOverlap,
          mutedUntil: zone.mutedUntil ? zone.mutedUntil.toISOString() : null, rules: zoneRules, metrics: metricsOf(zoneRules),
        };
      }),
      cameraRules: rules.filter((r) => r.cameraId === cameraId).map(toRuntime),
      parents: Object.fromEntries(classes.map((c) => [c.code, c.parentCode])),
      names: Object.fromEntries(classes.map((c) => [c.code, { en: c.nameEn, bn: c.nameBn }])),
    };
    await this.redis.getClient().set(key, JSON.stringify(runtime), { EX: TTL_S });
    await this.redis.getClient().sAdd(`rt:site:${site.id}`, cameraId);
    return runtime;
  }

  /** Cameras, zones or rules of a site changed: forget the cache and tell its devices to refetch their config. */
  @OnEvent(EVENTS.CONFIG_CHANGED)
  async onConfigChanged(payload: { siteId: string }) {
    const client = this.redis.getClient();
    const cameraIds = await client.sMembers(`rt:site:${payload.siteId}`);
    if (cameraIds.length) await client.del(cameraIds.map((id) => `rt:cam:${id}`));
    await client.del(`rt:site:${payload.siteId}`);
    await this.deviceRepository.increment({ siteId: payload.siteId }, "configVersion", 1);
  }

  /** One camera's cached status changed (online/offline). */
  async dropCamera(cameraId: string) {
    await this.redis.getClient().del(`rt:cam:${cameraId}`);
  }
}

/** Which numbers the engine must remember over time for these rules. */
function metricsOf(rules: RuleRuntime[]): string[] {
  const metrics = new Set<string>();
  for (const rule of rules) {
    const p = rule.params;
    if (rule.kind === "presence") p.subjects.forEach((s: string) => metrics.add(`count.${s}`));
    if (rule.kind === "count_range" || rule.kind === "attribute_missing") metrics.add(`count.${p.subject}`);
    if (rule.kind === "proximity") [p.a, p.b].forEach((s: string) => metrics.add(`count.${s}`));
    if (rule.kind === "measure_threshold") metrics.add(`measure.${p.measure}`);
    if (rule.kind === "delta" || rule.kind === "anomaly") metrics.add(p.metric);
  }
  return [...metrics];
}
