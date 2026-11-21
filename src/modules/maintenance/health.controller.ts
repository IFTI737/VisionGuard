import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { DataSource } from "typeorm";

@ApiTags("health")
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisCacheService,
  ) {}

  /** "Is the process alive?" */
  @Get("healthz")
  healthz() {
    return { status: "ok", time: new Date().toISOString() };
  }

  /** "Can it serve requests?" Checks PostgreSQL and Redis. */
  @Get("readyz")
  async readyz() {
    try {
      await this.dataSource.query("SELECT 1");
      await this.redis.getClient().ping();
      return { status: "ready", database: "ok", redis: "ok" };
    } catch (error) {
      throw new ServiceUnavailableException({ status: "not ready", error: String(error) });
    }
  }
}
