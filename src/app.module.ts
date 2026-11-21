import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bull";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { PostgresDatabaseProviderModule } from "@/providers/database/postgres/provider.module";
import { RedisCacheModule } from "@/providers/cache/redis/redis-cache.module";
import { MailModule } from "@/providers/mail/mail.module";
import { StorageModule } from "@/providers/storage/storage.module";
import { appConfig } from "@/config/app.config";
import global_config from "@/config/global_config";
import { AuditModule } from "@/modules/audit/audit.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { UserModule } from "@/modules/user/user.module";
import { SiteModule } from "@/modules/site/site.module";
import { CatalogModule } from "@/modules/catalog/catalog.module";
import { BillingModule } from "@/modules/billing/billing.module";
import { DeviceModule } from "@/modules/device/device.module";
import { RuleModule } from "@/modules/rule/rule.module";
import { CameraModule } from "@/modules/camera/camera.module";
import { IngestionModule } from "@/modules/ingestion/ingestion.module";
import { AlertModule } from "@/modules/alert/alert.module";
import { IncidentModule } from "@/modules/incident/incident.module";
import { MediaModule } from "@/modules/media/media.module";
import { ConversationModule } from "@/modules/conversation/conversation.module";
import { SupportModule } from "@/modules/support/support.module";
import { ReportModule } from "@/modules/report/report.module";
import { AdminModule } from "@/modules/admin/admin.module";
import { MaintenanceModule } from "@/modules/maintenance/maintenance.module";
import { RealtimeModule } from "@/modules/realtime/realtime.module";

@Module({
  imports: [
    // ---- infrastructure (sir's boilerplate providers, now all connected) ----
    ConfigModule.forRoot({ isGlobal: true, load: [global_config] }),
    PostgresDatabaseProviderModule,
    RedisCacheModule,
    BullModule.forRoot({ url: appConfig.env.REDIS_URL }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ name: "default", limit: 300, ttl: 60_000 }], // per IP; stricter on auth routes
      storage: new ThrottlerStorageRedisService(appConfig.env.REDIS_URL),
    }),
    MailModule,
    StorageModule,

    // ---- features ----
    AuditModule,
    UserModule,
    AuthModule,
    SiteModule,
    CatalogModule,
    BillingModule,
    DeviceModule,
    RuleModule,
    CameraModule,
    IngestionModule,
    AlertModule,
    IncidentModule,
    MediaModule,
    ConversationModule,
    SupportModule,
    ReportModule,
    AdminModule,
    MaintenanceModule,
    RealtimeModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
