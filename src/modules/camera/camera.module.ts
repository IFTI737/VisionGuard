import { CameraController } from "@/modules/camera/camera.controller";
import { CameraService } from "@/modules/camera/camera.service";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Zone } from "@/modules/camera/entities/zone.entity";
import { ZoneService } from "@/modules/camera/zone.service";
import { RuleModule } from "@/modules/rule/rule.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([Camera, Zone]), RuleModule],
  controllers: [CameraController],
  providers: [CameraService, ZoneService],
  exports: [CameraService, ZoneService],
})
export class CameraModule {}
