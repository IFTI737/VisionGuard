import { EVENTS } from "@/common/constants/events";
import { EscalationPolicyDto } from "@/modules/alert/dto/alert.dto";
import { EscalationPolicy } from "@/modules/alert/entities/escalation-policy.entity";
import { EscalationStep } from "@/modules/alert/entities/escalation-step.entity";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";

/**
 * An escalation policy says who is told, how, and in which order:
 *   step 1, at once     : everyone, in the app + browser push + Telegram
 *   step 2, 2 min later : phone calls down the call list
 * Each site gets this default when it is created and can change it.
 */
@Injectable()
export class PolicyService {
  constructor(
    @InjectRepository(EscalationPolicy) private readonly policyRepository: Repository<EscalationPolicy>,
    @InjectRepository(EscalationStep) private readonly stepRepository: Repository<EscalationStep>,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(EVENTS.SITE_CREATED)
  async onSiteCreated(payload: { siteId: string; manager: EntityManager }) {
    const { manager, siteId } = payload;
    const policy = await manager.save(manager.create(EscalationPolicy, { siteId, name: "Default", isDefault: true, minSeverity: "high", repeatCount: 0 }));
    await manager.save([
      manager.create(EscalationStep, { policyId: policy.id, stepNo: 1, waitS: 0, channels: ["inapp", "webpush", "telegram"], audience: "all_members" }),
      manager.create(EscalationStep, { policyId: policy.id, stepNo: 2, waitS: 120, channels: ["call"], audience: "call_list", callCount: 3, ringTimeoutS: 30 }),
    ]);
  }

  async list(siteId: string) {
    const policies = await this.policyRepository.find({ where: { siteId }, order: { createdAt: "ASC" } });
    const result = [];
    for (const policy of policies) result.push({ ...policy, steps: await this.steps(policy.id) });
    return result;
  }

  steps(policyId: string) {
    return this.stepRepository.find({ where: { policyId }, order: { stepNo: "ASC" } });
  }

  async defaultFor(siteId: string) {
    const policy = await this.policyRepository.findOne({ where: { siteId, isDefault: true } });
    return policy ? { policy, steps: await this.steps(policy.id) } : null;
  }

  async create(siteId: string, dto: EscalationPolicyDto) {
    this.check(dto);
    const id = await this.dataSource.transaction(async (manager) => {
      const policy = await manager.save(manager.create(EscalationPolicy, { siteId, name: dto.name, minSeverity: dto.minSeverity ?? "low", repeatCount: dto.repeatCount ?? 0 }));
      await this.writeSteps(manager, policy.id, dto);
      return policy.id;
    });
    return this.getOne(siteId, id);
  }

  /** Replaces the policy and all its steps. */
  async replace(siteId: string, policyId: string, dto: EscalationPolicyDto) {
    this.check(dto);
    await this.getOne(siteId, policyId);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(EscalationPolicy, { id: policyId }, { name: dto.name, minSeverity: dto.minSeverity ?? "low", repeatCount: dto.repeatCount ?? 0 });
      await manager.delete(EscalationStep, { policyId });
      await this.writeSteps(manager, policyId, dto);
    });
    return this.getOne(siteId, policyId);
  }

  async remove(siteId: string, policyId: string) {
    const policy = await this.getOne(siteId, policyId);
    if (policy.isDefault) throw new BadRequestException("The default policy cannot be deleted. Change it instead.");
    await this.policyRepository.delete({ id: policyId });
  }

  private async getOne(siteId: string, policyId: string) {
    const policy = await this.policyRepository.findOne({ where: { id: policyId, siteId } });
    if (!policy) throw new NotFoundException("Policy not found");
    return { ...policy, steps: await this.steps(policyId) };
  }

  private check(dto: EscalationPolicyDto) {
    dto.steps.forEach((step, index) => {
      if ((step.audience === "role") !== !!step.role) throw new BadRequestException(`steps[${index}]: give "role" exactly when audience is "role"`);
    });
  }

  private async writeSteps(manager: EntityManager, policyId: string, dto: EscalationPolicyDto) {
    await manager.save(
      dto.steps.map((step, index) =>
        manager.create(EscalationStep, {
          policyId, stepNo: index + 1, waitS: step.waitS, channels: step.channels, audience: step.audience,
          role: step.role ?? null, callCount: step.callCount ?? 1, ringTimeoutS: step.ringTimeoutS ?? 30,
        }),
      ),
    );
  }
}
