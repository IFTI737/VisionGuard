import { NotificationEndpoint } from "@/modules/user/entities/notification-endpoint.entity";
import { User } from "@/modules/user/entities/user.entity";
import { UserController } from "@/modules/user/user.controller";
import { UserService } from "@/modules/user/user.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [TypeOrmModule.forFeature([User, NotificationEndpoint])],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
