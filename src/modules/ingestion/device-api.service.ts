import type { DeviceConfig } from "@/common/contracts";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { RuntimeConfigService } from "@/modules/ingestion/runtime-config.service";
import { ModelAssignment } from "@/modules/rule/entities/model-assignment.entity";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class DeviceApiService {
  constructor(
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(Zone) private readonly zoneRepository: Repository<Zone>,
    @InjectRepository(ModelAssignment) private readonly assignmentRepository: Repository<ModelAssignment>,
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
    private readonly runtime: RuntimeConfigService,
    private readonly ingestion: IngestionService,
    private readonly redis: RedisCacheService,
  ) {}

  /** What the device must do: which cameras, which AI models, how often, which regions to measure. */
  async config(device: Device): Promise<DeviceConfig> {
    const fresh = await this.deviceRepository.findOneOrFail({ where: { id: device.id } });
    const cameras = await this.cameraRepository.find({ where: { deviceId: device.id } });
    const result: DeviceConfig = { configVersion: fresh.configVersion, heartbeatS: 30, cameras: [] };
    for (const camera of cameras) {
      const assignments = await this.assignmentRepository.find({ where: { cameraId: camera.id, enabled: true }, relations: { model: true } });
      const rt = await this.runtime.forCamera(camera.id);
      result.cameras.push({
        cameraId: camera.id,
        recording: { mode: camera.recordingMode, segmentS: 60 },
        snapshotEveryS: 0,
        models: assignments.map((a) => ({
          code: a.model.code, version: a.model.version, task: a.model.task, stage: a.model.stage as 1 | 2,
          triggerClass: a.model.triggerClassCode ?? undefined, artifactUrl: a.model.artifactUrl ?? "",
          inputSize: a.model.inputSize, activeWhen: a.activeWhen, frameIntervalMs: a.frameIntervalMs,
          conf: { default: a.model.defaultConf, ...a.confOverrides },
        })),
        // zones whose rules need a number measured by the device itself (shelf fill, stock count)
        rois: (rt?.zones ?? []).flatMap((z) =>
          z.metrics.filter((m) => m.startsWith("measure.")).map((m) => ({ zoneId: z.id, polygon: z.polygon, measure: m.slice(8), everyS: 10 })),
        ),
        // zones where the second-stage model (helmet, vest) is worth running
        stage2Zones: (rt?.zones ?? [])
          .filter((z) => z.rules.some((r) => r.kind === "attribute_missing"))
          .map((z) => ({ zoneId: z.id, polygon: z.polygon, attrs: [...new Set(z.rules.filter((r) => r.kind === "attribute_missing").flatMap((r) => r.params.required as string[]))] })),
      });
    }
    return result;
  }

  /** Every 30 seconds. Also how a device without a WebSocket receives commands. */
  async heartbeat(device: Device, body: { swVersion: string; cameras: { cameraId: string; state: "ok" | "no_signal" }[] }) {
    await this.deviceRepository.update({ id: device.id }, { swVersion: body.swVersion, lastSeenAt: new Date() });
    for (const cam of body.cameras) {
      const rt = await this.runtime.forCamera(cam.cameraId);
      if (!rt || rt.deviceId !== device.id) continue;
      if (cam.state === "ok") await this.ingestion.markSeen(rt);
      else if (rt.status !== "no_signal") {
        await this.cameraRepository.update({ id: cam.cameraId }, { status: "no_signal" });
        await this.runtime.dropCamera(cam.cameraId);
      }
    }
    const client = this.redis.getClient();
    const commands: unknown[] = [];
    for (let raw = await client.lPop(`cmd:${device.id}`); raw; raw = await client.lPop(`cmd:${device.id}`)) commands.push(JSON.parse(raw));
    const fresh = await this.deviceRepository.findOneOrFail({ where: { id: device.id } });
    return { serverTime: new Date().toISOString(), configVersion: fresh.configVersion, commands };
  }
}
