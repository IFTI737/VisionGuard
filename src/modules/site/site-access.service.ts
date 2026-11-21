import { ROLE_PRESETS } from "@/common/constants/permissions";
import { SiteContext } from "@/common/decorators/current-user.decorator";
import { MemberAreaScope } from "@/modules/site/entities/member-area-scope.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { Site } from "@/modules/site/entities/site.entity";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

/**
 * Answers "may this user enter this site, and what may they do there?".
 * Used by SiteMemberGuard on every site route.
 */
@Injectable()
export class SiteAccessService {
  constructor(
    @InjectRepository(Site) private readonly siteRepository: Repository<Site>,
    @InjectRepository(SiteMember) private readonly memberRepository: Repository<SiteMember>,
    @InjectRepository(MemberAreaScope) private readonly scopeRepository: Repository<MemberAreaScope>,
  ) {}

  async resolve(siteId: string, userId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(siteId || "")) return null;
    const member = await this.memberRepository.findOne({ where: { siteId, userId, status: "active" } });
    if (!member) return null;
    const site = await this.siteRepository.findOne({ where: { id: siteId } }); // soft-deleted sites are skipped
    if (!site || site.status === "deleted") return null;

    const permissions = [...new Set([...(ROLE_PRESETS[member.role] ?? []), ...member.permissions])];
    let areaIds: string[] | null = null;
    if (!member.allAreas) {
      const scopes = await this.scopeRepository.find({ where: { memberId: member.id } });
      areaIds = scopes.map((s) => s.areaId);
    }
    return { site, member, permissions, areaIds };
  }

  /** A helper limited to some areas may not touch anything in another area. */
  static assertArea(ctx: SiteContext, areaId: string | null | undefined) {
    if (ctx.areaIds === null) return;
    if (!areaId || !ctx.areaIds.includes(areaId))
      throw new ForbiddenException({ statusCode: 403, code: "outside_area_scope", message: "This is outside the areas you were given access to" });
  }
}
