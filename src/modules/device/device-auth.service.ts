import { randomToken, safeEqual, sha256 } from "@/common/helpers/crypto.helper";
import { DeviceCredential } from "@/modules/device/entities/device-credential.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

/**
 * Device keys look like  vgk_<prefix>_<secret>.
 * The prefix is stored in clear so the row can be found; of the whole key only
 * a SHA-256 hash is stored. A stolen database therefore gives no usable keys.
 */
@Injectable()
export class DeviceAuthService {
  constructor(
    @InjectRepository(Device) private readonly deviceRepository: Repository<Device>,
    @InjectRepository(DeviceCredential) private readonly credentialRepository: Repository<DeviceCredential>,
  ) {}

  /** Creates a key. The full key is returned once and can never be read again. */
  async createKey(manager: EntityManager, deviceId: string, createdBy: string | null, label?: string, expiresAt?: Date) {
    const prefix = randomToken(6).replace(/[-_]/g, "x");
    const key = `vgk_${prefix}_${randomToken(24)}`;
    const credential = await manager.save(
      manager.create(DeviceCredential, { deviceId, keyPrefix: prefix, keyHash: sha256(key), label: label ?? null, expiresAt: expiresAt ?? null, createdBy }),
    );
    return { credential: { id: credential.id, keyPrefix: prefix, label: credential.label, expiresAt: credential.expiresAt }, key };
  }

  async verifyKey(key: string, ip?: string): Promise<Device | null> {
    const parts = key.split("_"); // ["vgk", prefix, secret]
    if (parts.length < 3 || parts[0] !== "vgk") return null;
    const credential = await this.credentialRepository
      .createQueryBuilder("c")
      .addSelect("c.keyHash")
      .where("c.keyPrefix = :prefix", { prefix: parts[1] })
      .getOne();
    if (!credential || credential.revokedAt) return null;
    if (credential.expiresAt && credential.expiresAt < new Date()) return null;
    if (!safeEqual(credential.keyHash, sha256(key))) return null;

    const device = await this.deviceRepository.findOne({ where: { id: credential.deviceId } });
    if (!device || device.status !== "active") return null;
    // "last seen" is useful on the devices screen; no need to wait for it
    void this.credentialRepository.update({ id: credential.id }, { lastUsedAt: new Date() });
    void this.deviceRepository.update({ id: device.id }, { lastSeenAt: new Date(), lastIp: ip ?? null });
    return device;
  }
}
