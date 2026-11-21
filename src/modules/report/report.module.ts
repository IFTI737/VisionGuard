import { IngestionModule } from "@/modules/ingestion/ingestion.module";
import { MediaModule } from "@/modules/media/media.module";
import { ExportJob } from "@/modules/report/entities/export-job.entity";
import { ExportProcessor, ReportController } from "@/modules/report/report.controller";
import { ReportService } from "@/modules/report/report.service";
import { QUEUE } from "@/providers/queue/redis/queues";
import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([ExportJob]), BullModule.registerQueue({ name: QUEUE.EXPORT }), IngestionModule, MediaModule],
  controllers: [ReportController],
  providers: [ReportService, ExportProcessor],
})
export class ReportModule {}
