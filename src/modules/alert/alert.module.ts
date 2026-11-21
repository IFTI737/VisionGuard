import { AlertController, AlertWebhookController } from "@/modules/alert/alert.controller";
import { AlertService } from "@/modules/alert/alert.service";
import { CallService } from "@/modules/alert/call.service";
import { DeliveryService } from "@/modules/alert/delivery.service";
import { AlertRecipient } from "@/modules/alert/entities/alert-recipient.entity";
import { Alert } from "@/modules/alert/entities/alert.entity";
import { DeliveryAttempt } from "@/modules/alert/entities/delivery-attempt.entity";
import { EscalationPolicy } from "@/modules/alert/entities/escalation-policy.entity";
import { EscalationStep } from "@/modules/alert/entities/escalation-step.entity";
import { DeliveryProcessor, EscalationProcessor } from "@/modules/alert/escalation.processor";
import { PolicyService } from "@/modules/alert/policy.service";
import { NotificationEndpoint } from "@/modules/user/entities/notification-endpoint.entity";
import { User } from "@/modules/user/entities/user.entity";
import { UserModule } from "@/modules/user/user.module";
import { QUEUE } from "@/providers/queue/redis/queues";
import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forFeature([EscalationPolicy, EscalationStep, Alert, AlertRecipient, DeliveryAttempt, NotificationEndpoint, User]),
    BullModule.registerQueue({ name: QUEUE.ESCALATION }, { name: QUEUE.DELIVERY }),
    UserModule,
  ],
  controllers: [AlertController, AlertWebhookController],
  providers: [AlertService, PolicyService, DeliveryService, CallService, EscalationProcessor, DeliveryProcessor],
  exports: [AlertService, PolicyService],
})
export class AlertModule {}
