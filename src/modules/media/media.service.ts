import { EVENTS } from "@/common/constants/events";
import { signPayload, verifyPayload } from "@/common/helpers/crypto.helper";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { appConfig } from "@/config/app.config";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { IncidentSegment } from "@/modules/media/entities/incident-segment.entity";
import { Media } from "@/modules/media/entities/media.entity";
import { RecordingSegment } from "@/modules/media/entities/recording-segment.entity";
import { Snapshot } from "@/modules/media/entities/snapshot.entity";
import { SiteAccessService } from "@/modules/site/site-access.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { StorageService } from "@/providers/storage/storage.service";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { DataSource, In, Repository } from "typeorm";

const URL_TTL_S = 300; // a media link works for 5 minutes

export interface SnapshotMeta { cameraId: string; capturedAt: string; trigger?: "periodic" | "incident" | "manual" | "tamper"; incidentId?: string; detections?: unknown[]; modelCode?: string; frame?: { w: number; h: number } }
export interface SegmentMeta { cameraId: string; startedAt: string; durationMs: number; container: "webm" | "mp4" | "fmp4"; codec?: string }

/**
 * Snapshot images and video segments.
 * Files are never public. The API hands out a link with a signed token that
 * works for 5 minutes; only the route below can turn that token into bytes.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectRepository(Media) private readonly mediaRepository: Repository<Media>,
    @InjectRepository(Snapshot) private readonly snapshotRepository: Repository<Snapshot>,
    @InjectRepository(RecordingSegment) private readonly segmentRepository: Repository<RecordingSegment>,
    @InjectRepository(IncidentSegment) private readonly incidentSegmentRepository: Repository<IncidentSegment>,
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
    private readonly redis: RedisCacheService,
  ) {}

  // ---------------- storing ----------------

  async store(siteId: string | null, kind: "image" | "video" | "file", folder: string, extension: string, mime: string, data: Buffer, expiresAt?: Date) {
    const objectKey = StorageService.key(siteId, folder, `${randomUUID()}.${extension}`);
    await this.storage.put(objectKey, data);
    return this.mediaRepository.save(this.mediaRepository.create({ siteId, kind, storage: "local", objectKey, mime, bytes: String(data.length), expiresAt: expiresAt ?? null }));
  }

  /** A device uploads one picture, with the boxes the model drew on it. */
  async saveSnapshot(device: Device, meta: SnapshotMeta, file: { buffer: Buffer; mimetype: string }) {
    const camera = await this.deviceCamera(device, meta.cameraId);
    if (!file.mimetype.startsWith("image/")) throw new BadRequestException("The file must be an image");
    const media = await this.store(device.siteId, "image", "snapshots", file.mimetype === "image/png" ? "png" : "jpg", file.mimetype, file.buffer);
    const capturedAt = new Date(meta.capturedAt);

    // which incident does this picture belong to? the one named, or one of this camera that is open around that time
    let incidentId = meta.incidentId ?? null;
    if (!incidentId) {
      const [open] = await this.dataSource.query(
        `SELECT id FROM incidents WHERE camera_id = $1 AND status IN ('open','acknowledged')
         AND $2::timestamptz BETWEEN clip_from AND coalesce(ended_at, clip_to) + interval '5 minutes' ORDER BY started_at DESC LIMIT 1`,
        [camera.id, capturedAt],
      );
      incidentId = open?.id ?? null;
    }
    const snapshot = await this.snapshotRepository.save(
      this.snapshotRepository.create({
        siteId: device.siteId, cameraId: camera.id, incidentId, mediaId: media.id, capturedAt,
        trigger: meta.trigger ?? (incidentId ? "incident" : "manual"), detections: meta.detections ?? [],
        modelCode: meta.modelCode ?? null, frameW: meta.frame?.w ?? null, frameH: meta.frame?.h ?? null,
      }),
    );
    if (incidentId) await this.dataSource.query(`UPDATE incidents SET cover_snapshot_id = $1 WHERE id = $2 AND cover_snapshot_id IS NULL`, [snapshot.id, incidentId]);
    return { snapshotId: snapshot.id, incidentId };
  }

  /** A device uploads one piece of video (about a minute). Pieces that overlap an incident are linked to it. */
  async saveSegment(device: Device, meta: SegmentMeta, file: { buffer: Buffer; mimetype: string }) {
    const camera = await this.deviceCamera(device, meta.cameraId);
    if (!meta.durationMs || meta.durationMs <= 0) throw new BadRequestException("durationMs must be positive");
    const startedAt = new Date(meta.startedAt);
    const media = await this.store(device.siteId, "video", "segments", meta.container === "webm" ? "webm" : "mp4", file.mimetype || "video/webm", file.buffer);
    try {
      const segment = await this.segmentRepository.save(
        this.segmentRepository.create({ siteId: device.siteId, cameraId: camera.id, startedAt, endedAt: new Date(startedAt.getTime() + meta.durationMs), container: meta.container, codec: meta.codec ?? null, stored: "cloud", mediaId: media.id }),
      );
      const linked = await this.linkSegments({ cameraId: camera.id });
      return { segmentId: segment.id, linkedToIncidents: linked };
    } catch (error: any) {
      if (error?.code === "23505") {
        // UNIQUE (camera_id, started_at): the device retried an upload that had already arrived
        await this.storage.remove(media.objectKey);
        await this.mediaRepository.delete({ id: media.id });
        throw new ConflictException("This segment was already uploaded");
      }
      throw error;
    }
  }

  /**
   * incident_segments is a join table: one incident clip can span several
   * segments, and one segment can belong to several incidents. A segment that
   * is linked here is kept past the plan's recording days.
   */
  async linkSegments(filter: { cameraId?: string; incidentId?: string }) {
    const rows = await this.dataSource.query(
      `INSERT INTO incident_segments (incident_id, segment_id)
       SELECT i.id, s.id FROM incidents i JOIN recording_segments s
         ON s.camera_id = i.camera_id AND s.started_at < i.clip_to AND s.ended_at > i.clip_from
       WHERE ($1::uuid IS NULL OR i.camera_id = $1) AND ($2::uuid IS NULL OR i.id = $2)
       ON CONFLICT DO NOTHING RETURNING segment_id`,
      [filter.cameraId ?? null, filter.incidentId ?? null],
    );
    return rows.length;
  }

  /** Video that arrived before the incident opened (the 30 seconds before it) is linked when the incident is created. */
  @OnEvent(EVENTS.INCIDENT_CREATED)
  async onIncidentCreated(payload: { id: string }) {
    await this.linkSegments({ incidentId: payload.id });
  }

  private async deviceCamera(device: Device, cameraId: string) {
    const camera = await this.cameraRepository.findOne({ where: { id: cameraId, siteId: device.siteId, deviceId: device.id } });
    if (!camera) throw new NotFoundException("This camera does not belong to this device");
    return camera;
  }

  // ---------------- reading ----------------

  signedUrl(mediaId: string) {
    const expiresAt = Date.now() + URL_TTL_S * 1000;
    const token = signPayload({ m: mediaId, e: expiresAt }, appConfig.env.MEDIA_TOKEN_SECRET);
    return { url: `${appConfig.env.PUBLIC_API_URL}/v1/media/content/${token}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  async urlFor(ctx: SiteContext, mediaId: string) {
    const media = await this.mediaRepository.findOne({ where: { id: mediaId, siteId: ctx.site.id } });
    if (!media) throw new NotFoundException("Media not found");
    const needed = media.kind === "video" ? "recordings.view" : "incidents.view";
    if (!ctx.permissions.includes(needed)) throw new ForbiddenException(`Your role does not have: ${needed}`);
    return this.signedUrl(media.id);
  }

  /** Turns a signed token back into the file. Supports HTTP Range, which video players need to seek. */
  async open(token: string, rangeHeader?: string) {
    const payload = verifyPayload<{ m: string; e: number }>(token, appConfig.env.MEDIA_TOKEN_SECRET);
    if (!payload || payload.e < Date.now()) throw new ForbiddenException("This link is invalid or has expired");
    const media = await this.mediaRepository.findOne({ where: { id: payload.m, status: "ready" } });
    if (!media) throw new NotFoundException("Media not found");
    const size = await this.storage.size(media.objectKey);
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
    if (!match) return { media, size, range: null, stream: this.storage.stream(media.objectKey) };
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) throw new BadRequestException("Bad Range");
    return { media, size, range: { start, end }, stream: this.storage.stream(media.objectKey, { start, end }) };
  }

  async listSnapshots(ctx: SiteContext, filter: { cameraId?: string; incidentId?: string }) {
    const snapshots = await this.snapshotRepository.find({
      where: { siteId: ctx.site.id, ...(filter.cameraId ? { cameraId: filter.cameraId } : {}), ...(filter.incidentId ? { incidentId: filter.incidentId } : {}) },
      order: { capturedAt: "DESC" }, take: 50,
    });
    const allowed = await this.allowedCameraIds(ctx);
    return snapshots.filter((s) => !allowed || allowed.has(s.cameraId)).map((s) => ({ ...s, ...this.signedUrl(s.mediaId) }));
  }

  /** The video of one incident: its segments in order, and where to start and stop inside each. */
  async incidentClip(ctx: SiteContext, incidentId: string) {
    const [incident] = await this.dataSource.query(`SELECT id, camera_id, clip_from, clip_to FROM incidents WHERE id = $1 AND site_id = $2`, [incidentId, ctx.site.id]);
    if (!incident) throw new NotFoundException("Incident not found");
    await this.assertCamera(ctx, incident.camera_id);
    const links = await this.incidentSegmentRepository.find({ where: { incidentId } });
    const segments = await this.segmentRepository.find({ where: { id: In(links.length ? links.map((l) => l.segmentId) : ["00000000-0000-0000-0000-000000000000"]) }, order: { startedAt: "ASC" } });
    return this.manifest(segments, new Date(incident.clip_from), new Date(incident.clip_to));
  }

  async cameraRecordings(ctx: SiteContext, cameraId: string, from: Date, to: Date) {
    await this.assertCamera(ctx, cameraId);
    const segments = await this.dataSource.getRepository(RecordingSegment).createQueryBuilder("s")
      .where("s.cameraId = :cameraId AND s.startedAt < :to AND s.endedAt > :from", { cameraId, from, to }).orderBy("s.startedAt", "ASC").take(200).getMany();
    return this.manifest(segments, from, to);
  }

  private manifest(segments: RecordingSegment[], from: Date, to: Date) {
    const last = segments[segments.length - 1];
    return {
      from: from.toISOString(), to: to.toISOString(),
      complete: !!last && last.endedAt >= to, // false while later pieces are still uploading
      segments: segments.filter((s) => s.mediaId).map((s) => {
        const durationMs = s.endedAt.getTime() - s.startedAt.getTime();
        return {
          url: this.signedUrl(s.mediaId!).url, container: s.container, startedAt: s.startedAt.toISOString(), durationMs,
          playFromMs: Math.max(0, from.getTime() - s.startedAt.getTime()), playToMs: Math.min(durationMs, to.getTime() - s.startedAt.getTime()),
        };
      }),
    };
  }

  /** "Take a picture now": the request waits in Redis and reaches the device with its next heartbeat (or at once over WebSocket). */
  async requestSnapshot(ctx: SiteContext, cameraId: string) {
    const camera = await this.assertCamera(ctx, cameraId);
    if (!camera.deviceId) throw new BadRequestException("This camera has no device");
    const command = { type: "snapshot.request", cameraId, requestId: randomUUID() };
    await this.redis.getClient().rPush(`cmd:${camera.deviceId}`, JSON.stringify(command));
    await this.redis.getClient().expire(`cmd:${camera.deviceId}`, 300);
    return { accepted: true, requestId: command.requestId };
  }

  // ---------------- retention (daily job) ----------------

  /** Deletes video older than the plan's recording days, except pieces linked to an incident. */
  async purgeOldSegments() {
    const rows = await this.dataSource.query(
      `SELECT s.id, s.media_id, m.object_key FROM recording_segments s
       JOIN media m ON m.id = s.media_id JOIN subscriptions sub ON sub.site_id = s.site_id JOIN plans p ON p.id = sub.plan_id
       WHERE s.ended_at < now() - make_interval(days => p.recording_days)
         AND NOT EXISTS (SELECT 1 FROM incident_segments x WHERE x.segment_id = s.id) LIMIT 500`,
    );
    for (const row of rows) {
      await this.segmentRepository.delete({ id: row.id });
      await this.mediaRepository.delete({ id: row.media_id });
      await this.storage.remove(row.object_key);
    }
    return { segmentsPurged: rows.length };
  }

  private async assertCamera(ctx: SiteContext, cameraId: string) {
    const camera = await this.cameraRepository.findOne({ where: { id: cameraId, siteId: ctx.site.id }, withDeleted: true });
    if (!camera) throw new NotFoundException("Camera not found");
    SiteAccessService.assertArea(ctx, camera.areaId);
    return camera;
  }

  private async allowedCameraIds(ctx: SiteContext) {
    if (ctx.areaIds === null) return null;
    const cameras = await this.cameraRepository.find({ where: { siteId: ctx.site.id }, withDeleted: true });
    return new Set(cameras.filter((c) => ctx.areaIds!.includes(c.areaId)).map((c) => c.id));
  }
}
