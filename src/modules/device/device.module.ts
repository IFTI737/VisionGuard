import { DeviceAuthService } from "@/modules/device/device-auth.service";
import { DeviceController } from "@/modules/device/device.controller";
import { DeviceService } from "@/modules/device/device.service";
import { DeviceCredential } from "@/modules/device/entities/device-credential.entity";
import { Device } from "@/modules/device/entities/device.entity";
import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

// Global: DeviceAuthService is needed by DeviceAuthGuard on the device API.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Device, DeviceCredential])],
  controllers: [DeviceController],
  providers: [DeviceService, DeviceAuthService],
  exports: [DeviceService, DeviceAuthService],
})
export class DeviceModule {}
