import { Plan } from "@/modules/billing/entities/plan.entity";
import { SubscriptionItem } from "@/modules/billing/entities/subscription-item.entity";
import { Subscription } from "@/modules/billing/entities/subscription.entity";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Not, Repository } from "typeorm";

/**
 * "What is this site allowed to have?"  One place answers it for the whole
 * backend: PlanLimitGuard, the rule service (is this pack bought?) and the
 * billing screens all ask here.
 */
@Injectable()
export class EntitlementService {
  constructor(
    @InjectRepository(Subscription) private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(SubscriptionItem) private readonly itemRepository: Repository<SubscriptionItem>,
    @InjectRepository(Plan) private readonly planRepository: Repository<Plan>,
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(SiteMember) private readonly memberRepository: Repository<SiteMember>,
  ) {}

  async forSite(siteId: string) {
    const subscription = await this.subscriptionRepository.findOne({ where: { siteId } });
    const plan = subscription ? await this.planRepository.findOne({ where: { id: subscription.planId } }) : null;
    const items = subscription ? await this.itemRepository.find({ where: { subscriptionId: subscription.id, endedAt: IsNull() } }) : [];
    return { subscription, plan, items, packIds: items.map((i) => i.packId) };
  }

  async usage(siteId: string) {
    const cameras = await this.cameraRepository.count({ where: { siteId } }); // soft-deleted cameras are not counted
    const members = await this.memberRepository.count({ where: { siteId, status: In(["active", "invited"]), role: Not("contact") } });
    return { cameras, members };
  }

  async checkLimit(siteId: string, resource: "cameras" | "members") {
    const { plan } = await this.forSite(siteId);
    const used = (await this.usage(siteId))[resource];
    const limit = resource === "cameras" ? (plan?.maxCameras ?? 0) : (plan?.maxMembers ?? null);
    return { allowed: limit === null || used < limit, used, limit, plan: plan?.name ?? "none" };
  }
}
