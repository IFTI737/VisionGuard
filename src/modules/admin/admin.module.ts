import { AdminController } from "@/modules/admin/admin.controller";
import { AdminService } from "@/modules/admin/admin.service";
import { DetectionFeedback } from "@/modules/incident/entities/detection-feedback.entity";
import { SupportModule } from "@/modules/support/support.module";
import { User } from "@/modules/user/entities/user.entity";
import { UserModule } from "@/modules/user/user.module";
import { QUEUE } from "@/providers/queue/redis/queues";
import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, DetectionFeedback]),
    BullModule.registerQueue({ name: QUEUE.INCIDENT }, { name: QUEUE.ESCALATION }, { name: QUEUE.DELIVERY }, { name: QUEUE.MAINTENANCE }, { name: QUEUE.EXPORT }),
    SupportModule,
    UserModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
