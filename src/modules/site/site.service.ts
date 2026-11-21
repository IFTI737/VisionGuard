import { EVENTS } from "@/common/constants/events";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { AuditService } from "@/modules/audit/audit.service";
import { CreateSiteDto, UpdateSiteDto } from "@/modules/site/dto/site.dto";
import { Area } from "@/modules/site/entities/area.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { User } from "@/modules/user/entities/user.entity";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class SiteService {
  constructor(
    @InjectRepository(Site) private readonly siteRepository: Repository<Site>,
    @InjectRepository(SiteMember) private readonly memberRepository: Repository<SiteMember>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  /**
   * Screen 1 of the 3-screen setup. One transaction creates the site, the
   * owner's membership and a first area. Other modules listen to "site.created"
   * inside the same transaction and add what they own: the trial subscription
   * (billing), the default escalation policy (alerts), the team room (chat).
   */
  async onboard(userId: string, dto: CreateSiteDto) {
    const user = await this.userRepository.findOneOrFail({ where: { id: userId } });
    if (!user.emailVerifiedAt)
      throw new ForbiddenException({ statusCode: 403, code: "email_not_verified", message: "Verify your email before creating a site" });

    const result = await this.dataSource.transaction(async (manager) => {
      const site = await manager.save(
        manager.create(Site, { name: dto.name, kind: dto.kind, timezone: dto.timezone ?? "Asia/Dhaka", address: dto.address ?? null, createdBy: userId }),
      );
      const owner = await manager.save(
        manager.create(SiteMember, { siteId: site.id, userId, role: "owner", status: "active", displayName: user.name, joinedAt: new Date(), callPriority: 1 }),
      );
      const area = await manager.save(manager.create(Area, { siteId: site.id, name: "Main area" }));
      await this.events.emitAsync(EVENTS.SITE_CREATED, { siteId: site.id, ownerMemberId: owner.id, manager });
      return { site, owner, area };
    });
    await this.audit.log({ siteId: result.site.id, actorKind: "user", actorId: userId, action: "site.create", entityType: "site", entityId: result.site.id });
    return { site: result.site, member: { id: result.owner.id, role: result.owner.role }, area: result.area };
  }

  /** Sites I belong to, with my role in each. */
  async listMine(userId: string) {
    const memberships = await this.memberRepository.find({ where: { userId, status: "active" }, relations: { site: true } });
    return memberships
      .filter((m) => m.site && m.site.status !== "deleted")
      .map((m) => ({ id: m.site.id, name: m.site.name, kind: m.site.kind, status: m.site.status, role: m.role, memberId: m.id }));
  }

  getOne(ctx: SiteContext) {
    return {
      site: ctx.site,
      me: { memberId: ctx.member.id, role: ctx.member.role, permissions: ctx.permissions, areaIds: ctx.areaIds },
    };
  }

  async update(ctx: SiteContext, dto: UpdateSiteDto) {
    await this.siteRepository.update({ id: ctx.site.id }, dto as any);
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "site.update", entityType: "site", entityId: ctx.site.id, data: { ...dto } });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return this.siteRepository.findOneOrFail({ where: { id: ctx.site.id } });
  }

  /** "Pause" stops new alerts for a while (the family is home, a vet is visiting the shed...). */
  async pause(ctx: SiteContext, minutes: number) {
    await this.siteRepository.update({ id: ctx.site.id }, { mode: "paused", pausedUntil: new Date(Date.now() + minutes * 60_000) });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return this.siteRepository.findOneOrFail({ where: { id: ctx.site.id } });
  }

  async resume(ctx: SiteContext) {
    await this.siteRepository.update({ id: ctx.site.id }, { mode: "armed", pausedUntil: null });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return this.siteRepository.findOneOrFail({ where: { id: ctx.site.id } });
  }

  /** Soft delete: the row stays 30 days so a mistake can be undone by support. */
  async remove(ctx: SiteContext) {
    if (ctx.member.role !== "owner") throw new ForbiddenException("Only the owner can delete the site");
    await this.siteRepository.update({ id: ctx.site.id }, { status: "deleted" });
    await this.siteRepository.softDelete({ id: ctx.site.id });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "site.delete", entityType: "site", entityId: ctx.site.id });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
  }
}
