import { CurrentDevice } from "@/common/decorators";
import { DeviceAuthGuard } from "@/common/guard";
import { DeviceService } from "@/modules/device/device.service";
import { PairDeviceDto } from "@/modules/device/dto/device.dto";
import { Device } from "@/modules/device/entities/device.entity";
import { DeviceApiService } from "@/modules/ingestion/device-api.service";
import { heartbeatSchema, readingsRequestSchema } from "@/modules/ingestion/dto/readings.dto";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { ZodType } from "zod";

/** Checks a body with a zod schema and answers 400 with one line per wrong field. */
function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException({ statusCode: 400, code: "invalid_payload", message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  return result.data;
}

/**
 * The only door through which detections enter. It does not matter who is
 * outside: the browser camera client, an edge box, a cloud worker running our
 * trained models, or Postman acting as a simulator. All send the same JSON.
 */
@ApiTags("device api")
@Controller("device")
export class DeviceApiController {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly deviceApi: DeviceApiService,
    private readonly ingestion: IngestionService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("pair")
  @HttpCode(200)
  async pair(@Body() dto: PairDeviceDto) {
    return await this.deviceService.pair(dto);
  }

  @SkipThrottle()
  @UseGuards(DeviceAuthGuard)
  @Get("config")
  async config(@CurrentDevice() device: Device) {
    return await this.deviceApi.config(device);
  }

  @SkipThrottle()
  @UseGuards(DeviceAuthGuard)
  @Post("readings")
  @HttpCode(202)
  async readings(@CurrentDevice() device: Device, @Body() body: unknown) {
    const { readings } = parse(readingsRequestSchema, body);
    return await this.ingestion.ingest(device, readings);
  }

  @SkipThrottle()
  @UseGuards(DeviceAuthGuard)
  @Post("heartbeat")
  @HttpCode(200)
  async heartbeat(@CurrentDevice() device: Device, @Body() body: unknown) {
    return await this.deviceApi.heartbeat(device, parse(heartbeatSchema, body ?? {}));
  }
}
