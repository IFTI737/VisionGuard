import { EVENTS } from "@/common/constants/events";
import { appConfig } from "@/config/app.config";
import { AccessTokenPayload } from "@/modules/auth/strategies/jwt.strategy";
import { Camera } from "@/modules/camera/entities/camera.entity";
import { Conversation } from "@/modules/conversation/entities/conversation.entity";
import { LiveViewSession } from "@/modules/media/entities/live-view-session.entity";
import { SiteAccessService } from "@/modules/site/site-access.service";
import { UserService } from "@/modules/user/user.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Logger } from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Namespace, Socket } from "socket.io";
import { Repository } from "typeorm";

/**
 * Live updates for the dashboard (Socket.IO namespace /app).
 * The browser connects with its access token:  io(url + "/app", { auth: { token } })
 *
 * Rooms decide who receives what:
 *   user:<userId>   personal events (an alert for me)
 *   site:<siteId>   events every member of the site may see
 *   full:<siteId>   members who may see every area
 *   area:<areaId>   members limited to some areas only join their areas
 *   conv:<id>       one chat
 * The services never talk to sockets. They emit in-process events
 * (EventEmitter2) and this gateway forwards them to the right rooms.
 */
@WebSocketGateway({ namespace: "/app", cors: { origin: true, credentials: true } })
export class AppGateway implements OnGatewayConnection {
  private readonly logger = new Logger(AppGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisCacheService,
    private readonly userService: UserService,
    private readonly siteAccess: SiteAccessService,
    private readonly events: EventEmitter2,
    @InjectRepository(Conversation) private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(Camera) private readonly cameraRepository: Repository<Camera>,
    @InjectRepository(LiveViewSession) private readonly liveRepository: Repository<LiveViewSession>,
  ) {}

  /** The same checks as JwtStrategy: signature, expiry, blacklist, token version, account status. */
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || String(client.handshake.headers.authorization ?? "").replace("Bearer ", "");
      const payload = this.jwt.verify<AccessTokenPayload>(token, { secret: appConfig.env.JWT_ACCESS_SECRET });
      if ((await this.redis.getClient().get(`bl:${payload.jti}`)) === "blacklisted") throw new Error("logged out");
      const state = await this.userService.getAuthState(payload.sub);
      if (!state || state.status !== "active" || state.tokenVersion !== payload.tv) throw new Error("session ended");
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
      // when the access token runs out, tell the client to refresh it and reconnect
      const timer = setTimeout(() => {
        client.emit("auth.expired", { reason: "expired" });
        client.disconnect(true);
      }, Math.max(0, payload.exp * 1000 - Date.now()));
      client.on("disconnect", () => clearTimeout(timer));
    } catch {
      client.emit("auth.expired", { reason: "logged_out" });
      client.disconnect(true);
    }
  }

  @SubscribeMessage("site.subscribe")
  async subscribeSite(@ConnectedSocket() client: Socket, @MessageBody() body: { siteId: string }) {
    const access = await this.siteAccess.resolve(body?.siteId, client.data.userId);
    if (!access) return { error: "not_a_member" };
    await client.join(`site:${access.site.id}`);
    if (access.areaIds === null) await client.join(`full:${access.site.id}`);
    else for (const areaId of access.areaIds) await client.join(`area:${areaId}`);
    client.data.sites = { ...(client.data.sites ?? {}), [access.site.id]: { memberId: access.member.id, permissions: access.permissions, areaIds: access.areaIds } };
    return { ok: true, role: access.member.role };
  }

  @SubscribeMessage("conversation.join")
  async joinConversation(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId: string }) {
    const conversation = await this.conversationRepository.findOne({ where: { id: body?.conversationId } });
    if (!conversation || !client.data.sites?.[conversation.siteId]?.permissions.includes("chat.use")) return { error: "not_allowed" };
    await client.join(`conv:${conversation.id}`);
    return { ok: true };
  }

  @SubscribeMessage("conversation.typing")
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId: string }) {
    client.to(`conv:${body?.conversationId}`).emit("conversation.typing", { conversationId: body?.conversationId, userId: client.data.userId });
  }

  // ---------------- live view: the API only passes WebRTC messages between browser and device ----------------

  @SubscribeMessage("live.start")
  async liveStart(@ConnectedSocket() client: Socket, @MessageBody() body: { cameraId: string }) {
    const camera = await this.cameraRepository.findOne({ where: { id: body?.cameraId } });
    const access = camera ? client.data.sites?.[camera.siteId] : null;
    if (!camera || !access?.permissions.includes("live.view")) return { error: "not_allowed" };
    if (access.areaIds !== null && !access.areaIds.includes(camera.areaId)) return { error: "outside_area_scope" };
    if (!camera.deviceId || camera.status !== "online") return { error: "camera_offline" };
    const session = await this.liveRepository.save(this.liveRepository.create({ siteId: camera.siteId, cameraId: camera.id, viewerUserId: client.data.userId }));
    await client.join(`live:${session.id}`);
    await this.redis.getClient().set(`live:${session.id}`, JSON.stringify({ deviceId: camera.deviceId, cameraId: camera.id }), { EX: 600 });
    const iceServers = [{ urls: ["stun:stun.l.google.com:19302"] }];
    this.events.emit(EVENTS.DEVICE_COMMAND, { deviceId: camera.deviceId, command: { type: "live.request", cameraId: camera.id, sessionId: session.id, iceServers } });
    return { sessionId: session.id, iceServers };
  }

  @SubscribeMessage("live.answer")
  async liveAnswer(@MessageBody() body: { sessionId: string; sdp: string }) {
    await this.toDevice(body?.sessionId, "live.answer", body);
  }

  @SubscribeMessage("live.ice")
  async liveIce(@MessageBody() body: { sessionId: string; candidate: unknown }) {
    await this.toDevice(body?.sessionId, "live.ice", body);
  }

  @SubscribeMessage("live.stop")
  async liveStop(@ConnectedSocket() client: Socket, @MessageBody() body: { sessionId: string }) {
    const raw = await this.redis.getClient().get(`live:${body?.sessionId}`);
    if (!raw) return;
    await this.liveRepository.update({ id: body.sessionId, viewerUserId: client.data.userId }, { endedAt: new Date(), endReason: "viewer_left" });
    this.events.emit(EVENTS.DEVICE_COMMAND, { deviceId: JSON.parse(raw).deviceId, command: { type: "live.stop", sessionId: body.sessionId } });
    await this.redis.getClient().del(`live:${body.sessionId}`);
  }

  private async toDevice(sessionId: string, event: string, body: unknown) {
    const raw = await this.redis.getClient().get(`live:${sessionId}`);
    if (raw) this.events.emit("device.relay", { deviceId: JSON.parse(raw).deviceId, event, body });
  }

  /** From the device gateway: the camera's WebRTC offer and candidates go to the viewer. */
  @OnEvent("app.relay")
  relayToViewer(payload: { sessionId: string; event: string; body: unknown }) {
    this.server.to(`live:${payload.sessionId}`).emit(payload.event, payload.body);
  }

  // ---------------- forwarding service events to rooms ----------------

  /** Events tied to one area go to members who see everything, and to members of that area. */
  private toArea(payload: { siteId: string; areaId?: string }, event: string, body: object) {
    const rooms = [`full:${payload.siteId}`, ...(payload.areaId ? [`area:${payload.areaId}`] : [])];
    this.server.to(rooms).emit(event, body);
  }

  @OnEvent(EVENTS.ZONE_STATE)
  onZoneState({ siteId, areaId, ...body }: any) { this.toArea({ siteId, areaId }, "zone.state", body); }

  @OnEvent(EVENTS.CAMERA_STATUS)
  onCameraStatus({ siteId, areaId, ...body }: any) { this.toArea({ siteId, areaId }, "camera.status", body); }

  @OnEvent(EVENTS.INCIDENT_CREATED)
  onIncidentCreated({ siteId, areaId, ...body }: any) { this.toArea({ siteId, areaId }, "incident.created", body); }

  @OnEvent(EVENTS.INCIDENT_UPDATED)
  onIncidentUpdated({ siteId, areaId, ...body }: any) { this.toArea({ siteId, areaId }, "incident.updated", body); }

  @OnEvent(EVENTS.ALERT_CREATED)
  onAlertCreated({ userId, siteId: _siteId, ...body }: any) { this.server.to(`user:${userId}`).emit("alert.created", body); }

  @OnEvent(EVENTS.ALERT_UPDATED)
  onAlertUpdated({ siteId, ...body }: any) { this.server.to(`site:${siteId}`).emit("alert.updated", body); }

  @OnEvent(EVENTS.ALERT_RECIPIENT)
  onAlertRecipient({ siteId, ...body }: any) { this.server.to(`site:${siteId}`).emit("alert.recipient", body); }

  @OnEvent(EVENTS.MESSAGE_CREATED)
  onMessage({ siteId: _siteId, ...body }: any) { this.server.to(`conv:${body.conversationId}`).emit("message.created", body); }

  @OnEvent(EVENTS.EXPORT_READY)
  onExportReady({ siteId, ...body }: any) { this.server.to(`site:${siteId}`).emit("export.ready", body); }
}
