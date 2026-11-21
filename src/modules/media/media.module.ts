import { Camera } from "@/modules/camera/entities/camera.entity";
import { IncidentSegment } from "@/modules/media/entities/incident-segment.entity";
import { LiveViewSession } from "@/modules/media/entities/live-view-session.entity";
import { Media } from "@/modules/media/entities/media.entity";
import { RecordingSegment } from "@/modules/media/entities/recording-segment.entity";
import { Snapshot } from "@/modules/media/entities/snapshot.entity";
import { DeviceMediaController, MediaContentController, MediaController } from "@/modules/media/media.controller";
import { MediaService } from "@/modules/media/media.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([Media, Snapshot, RecordingSegment, IncidentSegment, LiveViewSession, Camera])],
  controllers: [DeviceMediaController, MediaController, MediaContentController],
  providers: [MediaService],
  exports: [MediaService, TypeOrmModule],
})
export class MediaModule {}
