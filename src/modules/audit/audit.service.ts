import { AuditLog } from "@/modules/audit/entities/audit-log.entity";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

export interface AuditEntry {
  siteId?: string | null;
  actorKind: "user" | "staff" | "device" | "system";
  actorId?: string | null;
  action: string; // "member.invite", "rule.update", "admin.site.view", ...
  entityType?: string;
  entityId?: string;
  ip?: string;
  data?: Record<string, unknown>;
}

/** Who did what, when. Written for every change that matters and every staff look at a site. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly auditRepository: Repository<AuditLog>) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.auditRepository.insert({
        siteId: entry.siteId ?? null,
        actorKind: entry.actorKind,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        ip: entry.ip ?? null,
        data: (entry.data ?? {}) as any,
      });
    } catch (error) {
      // The audit log must never break the action it describes.
      this.logger.error(`audit failed for ${entry.action}: ${error}`);
    }
  }
}
