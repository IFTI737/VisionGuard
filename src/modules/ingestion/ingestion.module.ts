import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { ObjectClass } from "@/modules/catalog/entities/object-class.entity";
import { RuleTemplate } from "@/modules/catalog/entities/rule-template.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { DeviceApiController } from "@/modules/ingestion/device-api.controller";
import { DeviceApiService } from "@/modules/ingestion/device-api.service";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { LiveController } from "@/modules/ingestion/live.controller";
import { MetricsService } from "@/modules/ingestion/metrics.service";
import { RuntimeConfigService } from "@/modules/ingestion/runtime-config.service";
import { ModelAssignment } from "@/modules/rule/entities/model-assignment.entity";
import { Rule } from "@/modules/rule/entities/rule.entity";
import { QUEUE } from "@/providers/queue/redis/queues";
import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forFeature([Camera, Zone, Rule, RuleTemplate, ObjectClass, Device, ModelAssignment]),
    BullModule.registerQueue({ name: QUEUE.INCIDENT }),
  ],
  controllers: [DeviceApiController, LiveController],
  providers: [IngestionService, RuntimeConfigService, MetricsService, DeviceApiService],
  exports: [IngestionService, RuntimeConfigService, MetricsService, DeviceApiService],
})
export class IngestionModule {}
