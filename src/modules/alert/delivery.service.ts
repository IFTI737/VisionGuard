import { SEVERITY_ORDER } from "@/common/constants/permissions";
import { EVENTS } from "@/common/constants/events";
import { appConfig } from "@/config/app.config";
import { AlertRecipient } from "@/modules/alert/entities/alert-recipient.entity";
import { Alert } from "@/modules/alert/entities/alert.entity";
import { DeliveryAttempt } from "@/modules/alert/entities/delivery-attempt.entity";
import { SiteMember } from "@/modules/site/entities/site-member.entity";
import { NotificationEndpoint } from "@/modules/user/entities/notification-endpoint.entity";
import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import axios from "axios";
import { IsNull, Repository } from "typeorm";
import * as webpush from "web-push";

export type Channel = "inapp" | "webpush" | "telegram";

/**
 * Sends one notification to one person on one channel and records what
 * happened in delivery_attempts. Every channel works without its outside
 * account: the attempt is then recorded as "failed" with the reason, and the
 * escalation simply goes on to the next step.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    @InjectRepository(DeliveryAttempt) private readonly attemptRepository: Repository<DeliveryAttempt>,
    @InjectRepository(AlertRecipient) private readonly recipientRepository: Repository<AlertRecipient>,
    @InjectRepository(Alert) private readonly alertRepository: Repository<Alert>,
    @InjectRepository(SiteMember) private readonly memberRepository: Repository<SiteMember>,
    @InjectRepository(NotificationEndpoint) private readonly endpointRepository: Repository<NotificationEndpoint>,
    private readonly events: EventEmitter2,
  ) {
    if (appConfig.env.VAPID_PUBLIC_KEY && appConfig.env.VAPID_PRIVATE_KEY)
      webpush.setVapidDetails(appConfig.env.VAPID_SUBJECT, appConfig.env.VAPID_PUBLIC_KEY, appConfig.env.VAPID_PRIVATE_KEY);
  }

  async send(recipientId: string, channel: Channel, ackToken: string, attemptNo: number) {
    const recipient = await this.recipientRepository.findOne({ where: { id: recipientId } });
    if (!recipient) return;
    const alert = await this.alertRepository.findOneOrFail({ where: { id: recipient.alertId } });
    if (alert.status !== "active") return; // acknowledged meanwhile: nothing more is sent
    const member = await this.memberRepository.findOneOrFail({ where: { id: recipient.memberId } });

    const skip = this.blockedByPreference(member, channel, alert.severity);
    const attempt = await this.attemptRepository.save(
      this.attemptRepository.create({ recipientId, channel, attemptNo, status: skip ? "cancelled" : "queued", error: skip }),
    );
    if (skip) return;

    try {
      const sent = await this.dispatch(channel, alert, member, ackToken);
      await this.attemptRepository.update({ id: attempt.id }, { status: sent.status, provider: sent.provider, providerRef: sent.providerRef ?? null, endpointId: sent.endpointId ?? null, completedAt: new Date() });
      await this.recipientRepository.update({ id: recipientId, status: "pending" }, { status: "notified", notifiedAt: new Date() });
      this.events.emit(EVENTS.ALERT_RECIPIENT, { siteId: alert.siteId, alertId: alert.id, memberId: member.id, status: "notified" });
    } catch (error: any) {
      await this.attemptRepository.update({ id: attempt.id }, { status: "failed", error: String(error?.message ?? error).slice(0, 300), completedAt: new Date() });
    }
  }

  private async dispatch(channel: Channel, alert: Alert, member: SiteMember, ackToken: string) {
    if (channel === "inapp") {
      // the WebSocket gateway listens to this event and pushes it to the user's open dashboard
      if (member.userId) this.events.emit(EVENTS.ALERT_CREATED, { siteId: alert.siteId, userId: member.userId, id: alert.id, title: alert.title, severity: alert.severity, source: alert.source });
      return { status: "delivered" as const, provider: "inapp" } as { status: "delivered" | "sent"; provider: string; providerRef?: string; endpointId?: string };
    }

    if (!member.userId) throw new Error("member has no account, so no linked endpoint");
    const endpoint = await this.endpointRepository.findOne({ where: { userId: member.userId, kind: channel, revokedAt: IsNull() }, order: { createdAt: "DESC" } });
    if (!endpoint) throw new Error(`no ${channel} endpoint linked`);

    if (channel === "telegram") {
      if (!appConfig.env.TELEGRAM_BOT_TOKEN) throw new Error("telegram bot not configured (TELEGRAM_BOT_TOKEN)");
      const response = await axios.post(`https://api.telegram.org/bot${appConfig.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: endpoint.address,
        text: `🚨 ${alert.title}\n${alert.body ?? ""}`,
        reply_markup: { inline_keyboard: [[{ text: "✅ Acknowledge", callback_data: `ack:${ackToken}` }]] },
      }, { timeout: 8000 });
      await this.endpointRepository.update({ id: endpoint.id }, { lastSuccessAt: new Date(), failCount: 0 });
      return { status: "sent" as const, provider: "telegram", providerRef: String(response.data?.result?.message_id ?? ""), endpointId: endpoint.id };
    }

    // browser push
    if (!appConfig.env.VAPID_PUBLIC_KEY || !appConfig.env.VAPID_PRIVATE_KEY) throw new Error("browser push not configured (VAPID keys)");
    await webpush.sendNotification(
      { endpoint: endpoint.address, keys: endpoint.keys },
      JSON.stringify({ title: alert.title, body: alert.body, alertId: alert.id, ackToken }),
      { TTL: 300 },
    );
    await this.endpointRepository.update({ id: endpoint.id }, { lastSuccessAt: new Date(), failCount: 0 });
    return { status: "sent" as const, provider: "webpush", endpointId: endpoint.id };
  }

  /** A member can switch a channel off, or ask for it only from some severity up. In-app is always on. */
  private blockedByPreference(member: SiteMember, channel: Channel, severity: Alert["severity"]): string | null {
    if (channel === "inapp") return null;
    const pref = member.notifyPrefs?.channels?.[channel];
    if (pref?.enabled === false) return `${channel} switched off by the member`;
    if (pref?.minSeverity && SEVERITY_ORDER[severity] < SEVERITY_ORDER[pref.minSeverity as keyof typeof SEVERITY_ORDER])
      return `below the member's minimum severity for ${channel}`;
    return null;
  }
}
