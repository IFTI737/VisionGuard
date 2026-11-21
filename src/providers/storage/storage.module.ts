import { StorageService } from "@/providers/storage/storage.service";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
