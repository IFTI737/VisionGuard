import { AlertModule } from "@/modules/alert/alert.module";
import { DetectionFeedback } from "@/modules/incident/entities/detection-feedback.entity";
import { IncidentEvent } from "@/modules/incident/entities/incident-event.entity";
import { Incident } from "@/modules/incident/entities/incident.entity";
import { IncidentController, SharedIncidentController } from "@/modules/incident/incident.controller";
import { IncidentProcessor } from "@/modules/incident/incident.processor";
import { IncidentService } from "@/modules/incident/incident.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forFeature([Incident, IncidentEvent, DetectionFeedback]),
    BullModule.registerQueue({ name: QUEUE.INCIDENT }),
    AlertModule,
  ],
  controllers: [IncidentController, SharedIncidentController],
  providers: [IncidentService, IncidentProcessor],
  exports: [IncidentService, TypeOrmModule],
})
export class IncidentModule {}
