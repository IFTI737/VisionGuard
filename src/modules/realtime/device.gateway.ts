import { EVENTS } from "@/common/constants/events";
import { DeviceAuthService } from "@/modules/device/device-auth.service";
import { Device } from "@/modules/device/entities/device.entity";
import { DeviceApiService } from "@/modules/ingestion/device-api.service";
import { heartbeatSchema, readingsRequestSchema } from "@/modules/ingestion/dto/readings.dto";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Namespace, Socket } from "socket.io";

/**
 * The same device API as /v1/device/*, over a WebSocket (namespace /device),
 * for devices that send a reading every second:  io(url + "/device", { auth: { key: "vgk_..." } })
 * A reading sent here goes through exactly the same IngestionService as one sent by HTTP.
 */
@WebSocketGateway({ namespace: "/device", cors: { origin: true } })
export class DeviceGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly deviceAuth: DeviceAuthService,
    private readonly ingestion: IngestionService,
    private readonly deviceApi: DeviceApiService,
    private readonly redis: RedisCacheService,
    private readonly events: EventEmitter2,
  ) {}

  async handleConnection(client: Socket) {
    const device = await this.deviceAuth.verifyKey(String(client.handshake.auth?.key ?? ""), client.handshake.address);
    if (!device) return client.disconnect(true);
    client.data.device = device;
    await client.join(`device:${device.id}`);
  }

  @SubscribeMessage("reading")
  async reading(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const parsed = readingsRequestSchema.safeParse({ readings: [body] });
    if (!parsed.success) return { error: "invalid_payload", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    return this.ingestion.ingest(client.data.device as Device, parsed.data.readings);
  }

  @SubscribeMessage("heartbeat")
  async heartbeat(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const parsed = heartbeatSchema.safeParse(body ?? {});
    if (!parsed.success) return { error: "invalid_payload" };
    return this.deviceApi.heartbeat(client.data.device as Device, parsed.data);
  }

  // WebRTC messages from the camera go to the person watching
  @SubscribeMessage("live.offer")
  liveOffer(@MessageBody() body: { sessionId: string; sdp: string }) {
    this.events.emit("app.relay", { sessionId: body?.sessionId, event: "live.offer", body });
  }

  @SubscribeMessage("live.ice")
  liveIce(@MessageBody() body: { sessionId: string; candidate: unknown }) {
    this.events.emit("app.relay", { sessionId: body?.sessionId, event: "live.ice", body });
  }

  /** A command for a device: sent now if it is connected, and kept for its next HTTP heartbeat as well. */
  @OnEvent(EVENTS.DEVICE_COMMAND)
  async onCommand(payload: { deviceId: string; command: object }) {
    this.server.to(`device:${payload.deviceId}`).emit("command", payload.command);
    await this.redis.getClient().rPush(`cmd:${payload.deviceId}`, JSON.stringify(payload.command));
    await this.redis.getClient().expire(`cmd:${payload.deviceId}`, 300);
  }

  @OnEvent("device.relay")
  onRelay(payload: { deviceId: string; event: string; body: unknown }) {
    this.server.to(`device:${payload.deviceId}`).emit(payload.event, payload.body);
  }

  /** Cameras, zones or rules changed: connected devices refetch their config at once. */
  @OnEvent(EVENTS.CONFIG_CHANGED)
  onConfigChanged(payload: { siteId: string }) {
    for (const socket of this.server.sockets.values())
      if ((socket.data.device as Device | undefined)?.siteId === payload.siteId) socket.emit("command", { type: "config.changed" });
  }
}
