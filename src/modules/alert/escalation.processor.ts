import { AlertService } from "@/modules/alert/alert.service";
import { CallService } from "@/modules/alert/call.service";
import { Channel, DeliveryService } from "@/modules/alert/delivery.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { Process, Processor } from "@nestjs/bull";
import { Job } from "bull";

/** Delayed jobs: "run step 2 of this alert in 120 seconds". */
@Processor(QUEUE.ESCALATION)
export class EscalationProcessor {
  constructor(private readonly alerts: AlertService) {}

  @Process("step")
  async step(job: Job<{ alertId: string; stepNo: number; round: number }>) {
    await this.alerts.runStep(job.data.alertId, job.data.stepNo, job.data.round);
  }

  @Process("exhaust")
  async exhaust(job: Job<{ alertId: string }>) {
    await this.alerts.exhaust(job.data.alertId);
  }
}

/** One notification on one channel, or one phone call. Retried by Bull when a provider is down. */
@Processor(QUEUE.DELIVERY)
export class DeliveryProcessor {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly calls: CallService,
  ) {}

  @Process("send")
  async send(job: Job<{ recipientId: string; channel: Channel; ackToken: string; attemptNo: number }>) {
    await this.delivery.send(job.data.recipientId, job.data.channel, job.data.ackToken, job.data.attemptNo);
  }

  @Process("call")
  async call(job: Job<{ alertId: string; stepNo: number; order: number }>) {
    await this.calls.callNext(job.data.alertId, job.data.stepNo, job.data.order);
  }

  @Process("call-timeout")
  async callTimeout(job: Job<{ attemptId: string }>) {
    await this.calls.onTimeout(job.data.attemptId);
  }
}
