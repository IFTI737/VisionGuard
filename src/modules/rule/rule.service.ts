import { EVENTS } from "@/common/constants/events";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { AuditService } from "@/modules/audit/audit.service";
import { EntitlementService } from "@/modules/billing/entitlement.service";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { CatalogService } from "@/modules/catalog/catalog.service";
import { PackModel } from "@/modules/catalog/entities/pack-model.entity";
import { RuleTemplate } from "@/modules/catalog/entities/rule-template.entity";
import { CreateRuleDto, UpdateModelAssignmentDto, UpdateRuleDto } from "@/modules/rule/dto/rule.dto";
import { ModelAssignment } from "@/modules/rule/entities/model-assignment.entity";
import { Rule } from "@/modules/rule/entities/rule.entity";
import { validateRuleParams, validateSchedule } from "@/modules/rule/rule-params";
import { SiteAccessService } from "@/modules/site/site-access.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";

const NONE = ["00000000-0000-0000-0000-000000000000"];

@Injectable()
export class RuleService {
  constructor(
    @InjectRepository(Rule) private readonly ruleRepository: Repository<Rule>,
    @InjectRepository(ModelAssignment) private readonly assignmentRepository: Repository<ModelAssignment>,
    @InjectRepository(RuleTemplate) private readonly templateRepository: Repository<RuleTemplate>,
    @InjectRepository(PackModel) private readonly packModelRepository: Repository<PackModel>,
    @InjectRepository(Zone) private readonly zoneRepository: Repository<Zone>,
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    private readonly catalog: CatalogService,
    private readonly entitlement: EntitlementService,
    private readonly redis: RedisCacheService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: SiteContext, filter: { zoneId?: string; cameraId?: string }) {
    const rules = await this.ruleRepository.find({
      where: { siteId: ctx.site.id, ...(filter.zoneId ? { zoneId: filter.zoneId } : {}), ...(filter.cameraId ? { cameraId: filter.cameraId } : {}) },
      order: { createdAt: "ASC" },
    });
    if (ctx.areaIds === null) return rules;
    // a scoped member only sees rules of cameras in their areas
    const allowed = await this.allowedTargets(ctx);
    return rules.filter((r) => (r.zoneId ? allowed.zoneIds.has(r.zoneId) : allowed.cameraIds.has(r.cameraId!)));
  }

  /** A rule = a template from one of the site's packs + this zone + the site's own numbers. */
  async createForZone(ctx: SiteContext, zoneId: string, dto: CreateRuleDto, manager?: EntityManager) {
    const zone = await this.zoneRepository.findOne({ where: { id: zoneId, siteId: ctx.site.id } });
    if (!zone) throw new NotFoundException("Zone not found");
    const camera = await this.cameraRepository.findOneOrFail({ where: { id: zone.cameraId } });
    SiteAccessService.assertArea(ctx, camera.areaId);

    const { packIds } = await this.entitlement.forSite(ctx.site.id);
    const template = await this.catalog.findTemplateForSite(dto.templateCode, packIds);
    if (template.kind === "device_health") throw new BadRequestException("Camera health rules belong to a camera, not a zone. They are created with the camera.");

    const rule = this.build(ctx.site.id, template, dto, ctx.userId);
    rule.zoneId = zone.id;
    rule.name = dto.name ?? `${template.name} - ${zone.name}`;
    const saved = await (manager ?? this.ruleRepository.manager).save(rule);
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "rule.create", entityType: "rule", entityId: saved.id, data: { templateCode: template.code } });
    if (!manager) this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return saved;
  }

  async assertTemplateAvailable(siteId: string, templateCode: string) {
    const { packIds } = await this.entitlement.forSite(siteId);
    return this.catalog.findTemplateForSite(templateCode, packIds);
  }

  private build(siteId: string, template: RuleTemplate, dto: Partial<CreateRuleDto>, userId: string | null) {
    const rule = new Rule();
    rule.siteId = siteId;
    rule.templateId = template.id;
    rule.params = validateRuleParams(template.kind, template.defaultParams, dto.params);
    rule.severity = dto.severity ?? template.defaultSeverity;
    rule.schedule = dto.schedule !== undefined ? validateSchedule(dto.schedule) : template.defaultSchedule;
    rule.sustainS = dto.sustainS ?? template.defaultSustainS;
    rule.clearS = dto.clearS ?? template.defaultClearS;
    rule.cooldownS = dto.cooldownS ?? template.defaultCooldownS;
    rule.createdBy = userId;
    return rule;
  }

  /**
   * Runs when a camera is created (inside that transaction):
   *  - camera-health rules (offline, covered) from the templates marked auto_provision
   *  - which AI models this camera should run, from the site's packs
   */
  async provisionCamera(manager: EntityManager, siteId: string, cameraId: string, cameraName: string, userId: string) {
    const { packIds } = await this.entitlement.forSite(siteId);
    const templates = await this.templateRepository.find({ where: { packId: In(packIds.length ? packIds : NONE), kind: "device_health", autoProvision: true, status: "active" } });
    for (const template of templates) {
      const rule = this.build(siteId, template, {}, userId);
      rule.cameraId = cameraId;
      rule.name = `${template.name} - ${cameraName}`;
      await manager.save(rule);
    }
    await this.syncModelAssignments(manager, siteId, cameraId, packIds);
  }

  async syncModelAssignments(manager: EntityManager, siteId: string, cameraId: string, packIds: string[]) {
    const packModels = await this.packModelRepository.find({ where: { packId: In(packIds.length ? packIds : NONE) } });
    for (const modelId of new Set(packModels.map((pm) => pm.modelId)))
      await manager.createQueryBuilder().insert().into(ModelAssignment).values({ siteId, cameraId, modelId }).orIgnore().execute();
  }

  /** Rules that fit a zone's kind and are marked auto_provision (zone quickstart). */
  async autoTemplatesForZoneKind(siteId: string, zoneKind: string) {
    const { packIds } = await this.entitlement.forSite(siteId);
    const templates = await this.templateRepository.find({ where: { packId: In(packIds.length ? packIds : NONE), autoProvision: true, status: "active" } });
    return templates.filter((t) => t.kind !== "device_health" && t.zoneKinds.includes(zoneKind));
  }

  async getOne(ctx: SiteContext, ruleId: string) {
    const rule = await this.findOrFail(ctx, ruleId);
    const template = await this.templateRepository.findOneOrFail({ where: { id: rule.templateId } });
    const live = await this.redis.getClient().get(`rs:${rule.id}`); // written by the ingestion engine
    return {
      ...rule,
      template: { code: template.code, name: template.name, kind: template.kind, description: template.description },
      liveState: live ? JSON.parse(live) : { state: "ok" },
    };
  }

  async update(ctx: SiteContext, ruleId: string, dto: UpdateRuleDto) {
    const rule = await this.findOrFail(ctx, ruleId);
    const template = await this.templateRepository.findOneOrFail({ where: { id: rule.templateId } });
    const { params, schedule, ...rest } = dto;
    Object.assign(rule, rest);
    if (params) rule.params = validateRuleParams(template.kind, rule.params, params);
    if (schedule !== undefined) rule.schedule = validateSchedule(schedule);
    rule.version += 1; // incidents remember which version of the rule fired
    const saved = await this.ruleRepository.save(rule);
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "rule.update", entityType: "rule", entityId: ruleId, data: { ...dto } });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return saved;
  }

  async remove(ctx: SiteContext, ruleId: string) {
    const rule = await this.findOrFail(ctx, ruleId);
    await this.ruleRepository.softDelete({ id: rule.id });
    await this.redis.getClient().del(`rs:${rule.id}`);
    await this.audit.log({ siteId: ctx.site.id, actorKind: "user", actorId: ctx.userId, action: "rule.delete", entityType: "rule", entityId: ruleId });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
  }

  async mute(ctx: SiteContext, ruleId: string, minutes: number) {
    const rule = await this.findOrFail(ctx, ruleId);
    await this.ruleRepository.update({ id: rule.id }, { mutedUntil: minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null });
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return this.ruleRepository.findOneOrFail({ where: { id: rule.id } });
  }

  async listAssignments(ctx: SiteContext, cameraId: string) {
    return this.assignmentRepository.find({ where: { siteId: ctx.site.id, cameraId }, relations: { model: true } });
  }

  async updateAssignment(ctx: SiteContext, id: string, dto: UpdateModelAssignmentDto) {
    const result = await this.assignmentRepository.update({ id, siteId: ctx.site.id }, dto as any);
    if (!result.affected) throw new NotFoundException("Model assignment not found");
    this.events.emit(EVENTS.CONFIG_CHANGED, { siteId: ctx.site.id });
    return this.assignmentRepository.findOneOrFail({ where: { id } });
  }

  private async findOrFail(ctx: SiteContext, ruleId: string) {
    const rule = await this.ruleRepository.findOne({ where: { id: ruleId, siteId: ctx.site.id } });
    if (!rule) throw new NotFoundException("Rule not found");
    if (ctx.areaIds !== null) {
      const allowed = await this.allowedTargets(ctx);
      const ok = rule.zoneId ? allowed.zoneIds.has(rule.zoneId) : allowed.cameraIds.has(rule.cameraId!);
      if (!ok) SiteAccessService.assertArea(ctx, null);
    }
    return rule;
  }

  private async allowedTargets(ctx: SiteContext) {
    const cameras = await this.cameraRepository.find({ where: { siteId: ctx.site.id, areaId: In(ctx.areaIds?.length ? ctx.areaIds : NONE) } });
    const cameraIds = new Set(cameras.map((c) => c.id));
    const zones = await this.zoneRepository.find({ where: { siteId: ctx.site.id, cameraId: In(cameras.length ? [...cameraIds] : NONE) } });
    return { cameraIds, zoneIds: new Set(zones.map((z) => z.id)) };
  }
}
