import { randomToken, sha256 } from "@/common/helpers/crypto.helper";
import { EVENTS } from "@/common/constants/events";
import { AlertService } from "@/modules/alert/alert.service";
import { MockVoiceDto } from "@/modules/alert/dto/alert.dto";
import { AlertRecipient } from "@/modules/alert/entities/alert-recipient.entity";
import { Alert } from "@/modules/alert/entities/alert.entity";
import { DeliveryAttempt } from "@/modules/alert/entities/delivery-attempt.entity";
import { PolicyService } from "@/modules/alert/policy.service";
import { User } from "@/modules/user/entities/user.entity";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

/**
 * Phone calls down the call list, one person at a time.
 * The provider is "mock": no telecom account is needed. The call is written
 * to delivery_attempts as "ringing" and Postman plays the phone
 * (POST /v1/dev/mock-voice/:providerRef). A real provider later only has to
 * replace place() and send the same four events to the voice webhook.
 */
@Injectable()
export class CallService {
  private readonly logger = new Logger("MockVoice");

  constructor(
    @InjectRepository(DeliveryAttempt) private readonly attemptRepository: Repository<DeliveryAttempt>,
    @InjectRepository(AlertRecipient) private readonly recipientRepository: Repository<AlertRecipient>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly alerts: AlertService,
    private readonly policies: PolicyService,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  /** Calls person number `order` of the call list (0 = first). */
  async callNext(alertId: string, stepNo: number, order: number): Promise<void> {
    const placed = await this.dataSource.transaction(async (manager) => {
      // Same guarantee as in runStep: lock the alert, look at its status, only then dial.
      const alert = await manager.getRepository(Alert).createQueryBuilder("a").setLock("pessimistic_write").where("a.id = :alertId", { alertId }).getOne();
      if (!alert || alert.status !== "active" || !alert.policyId) return null;
      const step = (await this.policies.steps(alert.policyId)).find((s) => s.stepNo === stepNo);
      if (!step) return null;
      const list = await this.alerts.audience(alert.siteId, step, null);
      const member = list[order];
      if (!member) return null; // the list is finished; the "exhaust" job closes the alert

      let recipient = await manager.findOne(AlertRecipient, { where: { alertId, memberId: member.id } });
      if (!recipient) recipient = await manager.save(manager.create(AlertRecipient, { alertId, siteId: alert.siteId, memberId: member.id, stepNo, ackTokenHash: sha256(randomToken()) }));
      const phone = member.phone ?? (member.userId ? (await this.userRepository.findOne({ where: { id: member.userId } }))?.phoneNumber : null);
      const attemptNo = (await manager.count(DeliveryAttempt, { where: { recipientId: recipient.id, channel: "call" } })) + 1;
      const meta = { alertId, stepNo, order, phone: phone ?? null };

      if (!phone) {
        await manager.save(manager.create(DeliveryAttempt, { recipientId: recipient.id, channel: "call", attemptNo, status: "failed", provider: "mock", error: "no phone number", meta, completedAt: new Date() }));
        return { skip: true as const };
      }
      const providerRef = this.alerts.newProviderRef();
      const attempt = await manager.save(manager.create(DeliveryAttempt, { recipientId: recipient.id, channel: "call", attemptNo, status: "ringing", provider: "mock", providerRef, meta }));
      await manager.update(AlertRecipient, { id: recipient.id, status: "pending" }, { status: "notified", notifiedAt: new Date() });
      return { skip: false as const, attempt, name: member.displayName, phone, ringTimeoutS: step.ringTimeoutS, siteId: alert.siteId, title: alert.title, memberId: member.id };
    });
    if (!placed) return;
    if (placed.skip) return this.callNext(alertId, stepNo, order + 1);

    this.logger.log(`calling ${placed.name} (${placed.phone}) about "${placed.title}". Play the phone: POST /v1/dev/mock-voice/${placed.attempt.providerRef}`);
    this.events.emit(EVENTS.ALERT_RECIPIENT, { siteId: placed.siteId, alertId, memberId: placed.memberId, status: "ringing" });
    // if nobody picks up, try the next person
    await this.alerts.schedule(alertId, "call-timeout", { attemptId: placed.attempt.id }, placed.ringTimeoutS * 1000, `callto:${placed.attempt.id}`);
  }

  async onTimeout(attemptId: string) {
    const result = await this.attemptRepository.update({ id: attemptId, status: "ringing" }, { status: "no_answer", completedAt: new Date() });
    if (result.affected) await this.moveOn(attemptId);
  }

  /** What the phone did. Sent by Postman now, by the real voice provider's webhook later. */
  async providerEvent(providerRef: string, dto: MockVoiceDto) {
    const attempt = await this.attemptRepository.findOne({ where: { provider: "mock", providerRef } });
    if (!attempt) throw new NotFoundException("Unknown call reference");
    if (!["ringing", "answered"].includes(attempt.status))
      return { callStatus: attempt.status, note: "This call is already over" };

    if (dto.event === "answered") {
      await this.attemptRepository.update({ id: attempt.id }, { status: "answered" });
      return { callStatus: "answered", note: 'The person hears the alert. Send { "event": "digit", "digit": "1" } to acknowledge.' };
    }
    if (dto.event === "digit") {
      if (!dto.digit) throw new BadRequestException("digit is required");
      await this.attemptRepository.update({ id: attempt.id }, { status: "answered", completedAt: new Date(), meta: { ...attempt.meta, dtmf: dto.digit } as any });
      if (dto.digit !== "1") return { callStatus: "answered", note: "Only key 1 acknowledges" };
      const recipient = await this.recipientRepository.findOneOrFail({ where: { id: attempt.recipientId } });
      const { alert, acknowledgedNow } = await this.alerts.acknowledge(recipient.alertId, recipient.memberId, "call");
      return { callStatus: "answered", alertStatus: alert.status, acknowledgedNow };
    }
    // no_answer or busy
    await this.attemptRepository.update({ id: attempt.id, status: "ringing" }, { status: dto.event, completedAt: new Date() });
    await this.moveOn(attempt.id);
    return { callStatus: dto.event, note: "Trying the next person on the call list" };
  }

  private async moveOn(attemptId: string) {
    const attempt = await this.attemptRepository.findOneOrFail({ where: { id: attemptId } });
    await this.recipientRepository.update({ id: attempt.recipientId, status: "notified" }, { status: "unreachable" });
    await this.callNext(attempt.meta.alertId, attempt.meta.stepNo, attempt.meta.order + 1);
  }
}
