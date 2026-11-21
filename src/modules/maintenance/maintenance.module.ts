import { IngestionModule } from "@/modules/ingestion/ingestion.module";
import { DevController } from "@/modules/maintenance/dev.controller";
import { HealthController } from "@/modules/maintenance/health.controller";
import { MaintenanceProcessor } from "@/modules/maintenance/maintenance.processor";
import { MaintenanceService } from "@/modules/maintenance/maintenance.service";
import { MediaModule } from "@/modules/media/media.module";
import { QUEUE } from "@/providers/queue/redis/queues";
import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.MAINTENANCE }), IngestionModule, MediaModule],
  controllers: [DevController, HealthController],
  providers: [MaintenanceService, MaintenanceProcessor],
})
export class MaintenanceModule {}
