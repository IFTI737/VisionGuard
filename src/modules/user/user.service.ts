import { randomToken } from "@/common/helpers/crypto.helper";
import { appConfig } from "@/config/app.config";
import { UpdateMeDto, WebPushEndpointDto } from "@/modules/user/dto/user.dto";
import { NotificationEndpoint } from "@/modules/user/entities/notification-endpoint.entity";
import { User } from "@/modules/user/entities/user.entity";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";

export interface AuthState {
  status: string;
  platformRole: string;
  tokenVersion: number;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(NotificationEndpoint) private readonly endpointRepository: Repository<NotificationEndpoint>,
    private readonly redis: RedisCacheService,
  ) {}

  /** Read on every request by JwtStrategy, so it is cached in Redis for 60 seconds. */
  async getAuthState(userId: string): Promise<AuthState | null> {
    const key = `usr:${userId}`;
    const cached = await this.redis.getClient().get(key);
    if (cached) return JSON.parse(cached);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return null;
    const state: AuthState = { status: user.status, platformRole: user.platformRole, tokenVersion: user.tokenVersion };
    await this.redis.getClient().set(key, JSON.stringify(state), { EX: 60 });
    return state;
  }

  async invalidateAuthState(userId: string) {
    await this.redis.getClient().del(`usr:${userId}`);
  }

  /** After this, every access token the user holds is refused. */
  async bumpTokenVersion(userId: string) {
    await this.userRepository.increment({ id: userId }, "tokenVersion", 1);
    await this.invalidateAuthState(userId);
  }

  toPublic(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: !!user.emailVerifiedAt,
      platformRole: user.platformRole,
      locale: user.locale,
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }

  async getMe(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return this.toPublic(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.userRepository.update({ id: userId }, dto);
    return this.getMe(userId);
  }

  // ---- notification endpoints (where alerts reach this person) ----

  async listEndpoints(userId: string) {
    return this.endpointRepository.find({
      where: { userId, revokedAt: IsNull() },
      select: ["id", "kind", "label", "verifiedAt", "lastSuccessAt", "createdAt"],
    });
  }

  async addWebPush(userId: string, dto: WebPushEndpointDto) {
    await this.endpointRepository.upsert(
      { userId, kind: "webpush", address: dto.endpoint, keys: dto.keys as any, label: dto.label ?? null, verifiedAt: new Date(), revokedAt: null, failCount: 0 },
      ["kind", "address"],
    );
    return this.endpointRepository.findOneOrFail({ where: { kind: "webpush", address: dto.endpoint } });
  }

  async removeEndpoint(userId: string, id: string) {
    const result = await this.endpointRepository.update({ id, userId }, { revokedAt: new Date() });
    if (!result.affected) throw new NotFoundException("Endpoint not found");
  }

  /** Step 1 of linking Telegram: a one-time token the user sends to the bot (/start <token>). */
  async createTelegramLink(userId: string) {
    const token = randomToken(12);
    await this.redis.getClient().set(`tglink:${token}`, userId, { EX: 600 });
    const bot = appConfig.env.TELEGRAM_BOT_USERNAME;
    return {
      token,
      deepLink: bot ? `https://t.me/${bot}?start=${token}` : null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      note: bot ? undefined : "No Telegram bot configured. In development, POST /v1/webhooks/telegram/<secret> with a /start message, as shown in the Postman collection.",
    };
  }

  /** Step 2, called by the Telegram webhook. */
  async completeTelegramLink(token: string, chatId: string): Promise<boolean> {
    const userId = await this.redis.getClient().get(`tglink:${token}`);
    if (!userId) return false;
    await this.redis.getClient().del(`tglink:${token}`);
    await this.endpointRepository.upsert(
      { userId, kind: "telegram", address: chatId, label: "Telegram", verifiedAt: new Date(), revokedAt: null, failCount: 0 },
      ["kind", "address"],
    );
    return true;
  }
}
