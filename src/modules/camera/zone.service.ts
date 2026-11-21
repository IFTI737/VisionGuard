import { EVENTS } from "@/common/constants/events";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { AuditService } from "@/modules/audit/audit.service";
import { CameraService } from "@/modules/camera/camera.service";
import { CreateZoneDto, QuickstartZoneDto, UpdateZoneDto } from "@/modules/camera/dto/camera.dto";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { Rule } from "@/modules/rule/entities/rule.entity";
import { RuleService } from "@/modules/rule/rule.service";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class ZoneService {
  constructor(
    @InjectRepository(Zone) private readonly zoneRepository: Repository<Zone>,
    @InjectRepository(Rule) private readonly ruleRepository: Repository<Rule>,
    private readonly cameraService: CameraService,
    private readonly ruleService: RuleService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: SiteContext, cameraId: string) {
    await this.cameraService.findOrFail(ctx, cameraId);
    const zones = await this.zoneRepository.find({ where: { cameraId }, order: { createdAt: "ASC" } });
    const rules = await this.ruleRepository.find({ where: { siteId: ctx.site.id } });
    return zones.map((zone) => ({ ...zone, rules: rules.filter((r) => r.zoneId === zone.id) }));
  }

  /** A zone is a polygon drawn on the camera picture: "the shed", "the gate", "shelf 3". */
  async create(ctx: SiteContext, cameraId: string, dto: CreateZoneDto) {
    await this.cameraService.findOrFail(ctx, cameraId);
    try {
      const zone = await this.zoneRepository.save(
        this.zoneRepository.create({ siteId: ctx.site.id, cameraId, name: dto.name, kind: dto.kind ?? "general", polygon: dto.polygon, anchor: dto.anchor ?? "foot", minOverlap: dto.minOverlap ?? 0.35 }),
      );
      await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "zone.create", entityType: "zone", entityId: zone.id });
      this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
      return zone;
    } catch (error: any) {
      if (error?.code === "23505") throw new ConflictException("This camera already has a zone with that name");
      throw error;
    }
  }

  /**
   * Screen 3 of the setup: draw one zone, get working rules at once.
   * Creates the zone, the automatic rules for its kind, and any rules sent in the body.
   */
  async quickstart(ctx: SiteContext, cameraId: string, dto: QuickstartZoneDto) {
    const { rules: extra, ...zoneDto } = dto;
    // check the requested templates first, so a wrong one does not leave a half-made zone behind
    for (const ruleDto of extra ?? []) await this.ruleService.assertTemplateAvailable(ctx.site.id, ruleDto.templateCode);
    const zone = await this.create(ctx, cameraId, zoneDto);
    const rules: Rule[] = [];
    for (const template of await this.ruleService.autoTemplatesForZoneKind(ctx.site.id, zone.kind))
      rules.push(await this.ruleService.createForZone(ctx, zone.id, { templateCode: template.code }));
    for (const ruleDto of extra ?? []) rules.push(await this.ruleService.createForZone(ctx, zone.id, ruleDto));
    return { zone, rules };
  }

  async update(ctx: SiteContext, zoneId: string, dto: UpdateZoneDto) {
    const zone = await this.findOrFail(ctx, zoneId);
    Object.assign(zone, dto);
    zone.version += 1;
    const saved = await this.zoneRepository.save(zone);
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return saved;
  }

  async remove(ctx: SiteContext, zoneId: string) {
    const zone = await this.findOrFail(ctx, zoneId);
    await this.ruleRepository.softDelete({ zoneId: zone.id });
    await this.zoneRepository.softDelete({ id: zone.id });
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "zone.delete", entityType: "zone", entityId: zoneId });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
  }

  async mute(ctx: SiteContext, zoneId: string, minutes: number) {
    const zone = await this.findOrFail(ctx, zoneId);
    await this.zoneRepository.update({ id: zone.id }, { mutedUntil: minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return this.zoneRepository.findOneOrFail({ where: { id: zone.id } });
  }

  async findOrFail(ctx: SiteContext, zoneId: string) {
    const zone = await this.zoneRepository.findOne({ where: { id: zoneId, siteId: ctx.site.id } });
    if (!zone) throw new NotFoundException("Zone not found");
    await this.cameraService.findOrFail(ctx, zone.cameraId); // area scope
    return zone;
  }
}
