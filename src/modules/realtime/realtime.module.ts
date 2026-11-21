import { AuthModule } from "@/modules/auth/auth.module";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Conversation } from "@/modules/conversation/entities/conversation.entity";
import { IngestionModule } from "@/modules/ingestion/ingestion.module";
import { LiveViewSession } from "@/modules/media/entities/live-view-session.entity";
import { AppGateway } from "@/modules/realtime/app.gateway";
import { DeviceGateway } from "@/modules/realtime/device.gateway";
import { UserModule } from "@/modules/user/user.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Camera, LiveViewSession]), AuthModule, UserModule, IngestionModule],
  providers: [AppGateway, DeviceGateway],
})
export class RealtimeModule {}
