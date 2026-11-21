import { Pack } from "@/modules/catalog/entities/pack.entity";
import { RuleTemplate } from "@/modules/catalog/entities/rule-template.entity";
import { Plan } from "@/modules/billing/entities/plan.entity";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Repository } from "typeorm";

/**
 * The catalog is what VisionGuard sells and can detect: plans, packs (Core,
 * Farm, Construction, Shop...) and the rule templates inside each pack.
 * It is filled by the seed script (pnpm seed), not by migrations.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Plan) private readonly planRepository: Repository<Plan>,
    @InjectRepository(Pack) private readonly packRepository: Repository<Pack>,
    @InjectRepository(RuleTemplate) private readonly templateRepository: Repository<RuleTemplate>,
  ) {}

  listPlans() {
    return this.planRepository.find({ where: { isPublic: true, active: true }, order: { priceMinor: "ASC" } });
  }

  async listPacks() {
    const packs = await this.packRepository.find({ where: { status: "active", customSiteId: IsNull() }, order: { isDefault: "DESC", code: "ASC" } });
    const templates = await this.templateRepository.find({ where: { status: "active" }, order: { code: "ASC" } });
    return packs.map((pack) => ({
      ...pack,
      templates: templates
        .filter((t) => t.packId === pack.id)
        .map((t) => ({ code: t.code, name: t.name, description: t.description, kind: t.kind, defaultParams: t.defaultParams, defaultSeverity: t.defaultSeverity, zoneKinds: t.zoneKinds })),
    }));
  }

  /** A template the site is allowed to use: it must belong to one of the site's packs. */
  async findTemplateForSite(templateCode: string, packIds: string[]) {
    const template = await this.templateRepository.findOne({
      where: { code: templateCode, status: "active", packId: In(packIds.length ? packIds : ["00000000-0000-0000-0000-000000000000"]) },
      order: { id: "ASC" },
    });
    if (!template)
      throw new NotFoundException({ statusCode: 404, code: "template_not_available", message: `Rule template "${templateCode}" is not in the packs of this site. Add the pack in billing first.` });
    return template;
  }
}
