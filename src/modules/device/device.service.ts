import { EVENTS } from "@/common/constants/events";
import { sixDigitCode } from "@/common/helpers/crypto.helper";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { AuditService } from "@/modules/audit/audit.service";
import { DeviceAuthService } from "@/modules/device/device-auth.service";
import { CreateCredentialDto, CreateDeviceDto, PairDeviceDto, UpdateDeviceDto } from "@/modules/device/dto/device.dto";
import { DeviceCredential } from "@/modules/device/entities/device-credential.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, IsNull, Repository } from "typeorm";

const PAIRING_TTL_S = 600;

@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
    @InjectRepository(DeviceCredential) private readonly credentialRepository: Repository<DeviceCredential>,
    private readonly deviceAuth: DeviceAuthService,
    private readonly redis: RedisCacheService,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  async list(siteId: string) {
    const devices = await this.deviceRepository.find({ where: { siteId }, order: { createdAt: "ASC" } });
    const credentials = await this.credentialRepository.find({ where: { revokedAt: IsNull() }, select: ["id", "deviceId", "keyPrefix", "label", "expiresAt", "lastUsedAt", "createdAt"] });
    return devices.map((d) => ({ ...d, credentials: credentials.filter((c) => c.deviceId === d.id) }));
  }

  /**
   * A device is whatever produces readings: a phone's browser, an edge box
   * with RTSP cameras, a cloud worker, or the simulator (Postman).
   * It starts "pending" with a 6-digit pairing code valid for 10 minutes.
   */
  async create(ctx: SiteContext, dto: CreateDeviceDto) {
    const device = await this.deviceRepository.save(
      this.deviceRepository.create({
        siteId: ctx.site.id, kind: dto.kind, name: dto.name, createdBy: ctx.userId,
        // A simulator replays recorded time: "10 minutes" of readings can be sent in seconds.
        timeMode: dto.kind === "simulator" ? "event" : "wall",
      }),
    );
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "device.create", entityType: "device", entityId: device.id });
    return { device, pairing: await this.newPairingCode(ctx.site.id, device.id) };
  }

  async newPairingCode(siteId: string, deviceId: string) {
    await this.findOrFail(siteId, deviceId);
    const code = sixDigitCode();
    await this.redis.getClient().set(`pair:${code}`, deviceId, { EX: PAIRING_TTL_S });
    return { code, expiresAt: new Date(Date.now() + PAIRING_TTL_S * 1000).toISOString() };
  }

  /** Called by the device itself with the code a person typed in. Public route, rate limited. */
  async pair(dto: PairDeviceDto) {
    const deviceId = await this.redis.getClient().get(`pair:${dto.code}`);
    if (!deviceId) throw new BadRequestException("Pairing code is wrong or expired");
    await this.redis.getClient().del(`pair:${dto.code}`); // one use only
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Device, { id: deviceId }, { status: "active", swVersion: dto.swVersion ?? null });
      const { key } = await this.deviceAuth.createKey(manager, deviceId, null, "paired");
      return { deviceId, key, note: "Store this key. It is shown only once. Send it as: Authorization: Device <key>" };
    });
  }

  /** Makes a key directly (for gateways and for Postman). The device becomes active. */
  async createCredential(ctx: SiteContext, deviceId: string, dto: CreateCredentialDto) {
    await this.findOrFail(ctx.site.id, deviceId);
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.update(Device, { id: deviceId }, { status: "active" });
      return this.deviceAuth.createKey(manager, deviceId, ctx.userId, dto.label, dto.expiresAt ? new Date(dto.expiresAt) : undefined);
    });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "device.key_create", entityType: "device", entityId: deviceId });
    return { ...result, note: "The key is shown only once. Send it as: Authorization: Device <key>" };
  }

  /** Revoking works at once: the very next request with that key gets 401. */
  async revokeCredential(ctx: SiteContext, deviceId: string, credentialId: string) {
    await this.findOrFail(ctx.site.id, deviceId);
    const result = await this.credentialRepository.update({ id: credentialId, deviceId, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!result.affected) throw new NotFoundException("Key not found");
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "device.key_revoke", entityType: "device", entityId: deviceId });
  }

  async update(ctx: SiteContext, deviceId: string, dto: UpdateDeviceDto) {
    await this.findOrFail(ctx.site.id, deviceId);
    await this.deviceRepository.update({ id: deviceId }, dto);
    return this.findOrFail(ctx.site.id, deviceId);
  }

  async remove(ctx: SiteContext, deviceId: string) {
    await this.findOrFail(ctx.site.id, deviceId);
    // cameras.device_id becomes NULL by the foreign key (ON DELETE SET NULL (device_id))
    await this.deviceRepository.delete({ id: deviceId });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
  }

  private async findOrFail(siteId: string, deviceId: string) {
    const device = await this.deviceRepository.findOne({ where: { id: deviceId, siteId } });
    if (!device) throw new NotFoundException("Device not found");
    return device;
  }
}
