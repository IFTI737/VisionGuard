import { sha256, safeEqual } from "@/common/helpers/crypto.helper";
import type { RefreshTokensRevokeReason } from "@/common/constants/check-values";
import { appConfig } from "@/config/app.config";
import { RefreshToken } from "@/modules/auth/entities/refresh-token.entity";
import { RefreshTokenPayload } from "@/modules/auth/strategies/refresh-jwt.strategy";
import { User } from "@/modules/user/entities/user.entity";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { DataSource, IsNull, Repository } from "typeorm";

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

/**
 * Makes and checks tokens.
 *   access token  : JWT, 15 minutes, sent as "Authorization: Bearer ..."
 *   refresh token : JWT, 30 days, one row in refresh_tokens per token.
 * Every refresh replaces the token (rotation). If an already-replaced token
 * shows up again it was stolen, so every token of that login is revoked.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisCacheService,
    private readonly dataSource: DataSource,
    @InjectRepository(RefreshToken) private readonly refreshRepository: Repository<RefreshToken>,
  ) {}

  signAccessToken(user: User): string {
    return this.jwt.sign(
      { sub: user.id, email: user.email, roles: [user.platformRole], tv: user.tokenVersion, jti: randomUUID() },
      { secret: appConfig.env.JWT_ACCESS_SECRET, expiresIn: appConfig.env.JWT_ACCESS_TTL },
    );
  }

  /** A new login: new family. */
  async issuePair(user: User, client: ClientInfo, familyId: string = randomUUID()) {
    const refresh = await this.createRefreshRow(this.refreshRepository, user.id, familyId, client);
    return {
      accessToken: this.signAccessToken(user),
      refreshToken: refresh.token,
      expiresIn: appConfig.env.JWT_ACCESS_TTL,
    };
  }

  private async createRefreshRow(repository: Repository<RefreshToken>, userId: string, familyId: string, client: ClientInfo) {
    const id = randomUUID();
    const days = appConfig.env.JWT_REFRESH_TTL_DAYS;
    const token = this.jwt.sign(
      { sub: userId, jti: id, fam: familyId },
      { secret: appConfig.env.JWT_REFRESH_SECRET, expiresIn: `${days}d` },
    );
    await repository.insert({
      id,
      userId,
      familyId,
      tokenHash: sha256(token),
      userAgent: client.userAgent ?? null,
      ip: client.ip ?? null,
      expiresAt: new Date(Date.now() + days * 86400 * 1000),
    });
    return { id, token };
  }

  /** Swaps a valid refresh token for a new pair. Detects reuse of an old token. */
  async rotate(payload: RefreshTokenPayload & { token: string }, user: User, client: ClientInfo) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(RefreshToken);
      const row = await repository
        .createQueryBuilder("t")
        .addSelect("t.tokenHash")
        .where("t.id = :id", { id: payload.jti })
        .setLock("pessimistic_write")
        .getOne();
      if (!row || !safeEqual(row.tokenHash, sha256(payload.token)))
        throw new UnauthorizedException("Invalid refresh token");

      if (row.revokedAt) {
        // This token was already used or logged out. Someone is replaying it.
        await repository.update(
          { familyId: row.familyId, revokedAt: IsNull() },
          { revokedAt: new Date(), revokeReason: "reuse_detected" },
        );
        return null; // the caller answers 401 after the transaction commits
      }

      const next = await this.createRefreshRow(repository, user.id, row.familyId, client);
      await repository.update(
        { id: row.id },
        { revokedAt: new Date(), revokeReason: "rotated", replacedBy: next.id, lastUsedAt: new Date() },
      );
      return {
        accessToken: this.signAccessToken(user),
        refreshToken: next.token,
        expiresIn: appConfig.env.JWT_ACCESS_TTL,
      };
    });
  }

  /** Sir's Redis blacklist: the access token stops working now, not in 15 minutes. */
  async blacklistAccessToken(jti: string, exp: number): Promise<void> {
    const secondsLeft = exp - Math.floor(Date.now() / 1000);
    if (secondsLeft > 0)
      await this.redis.getClient().set(`bl:${jti}`, "blacklisted", { EX: secondsLeft });
  }

  async revokeByToken(token: string | null, reason: RefreshTokensRevokeReason): Promise<void> {
    if (!token) return;
    const payload = this.jwt.decode(token) as RefreshTokenPayload | null;
    if (!payload?.jti) return;
    await this.refreshRepository.update(
      { id: payload.jti, revokedAt: IsNull() },
      { revokedAt: new Date(), revokeReason: reason },
    );
  }

  async revokeAllForUser(userId: string, reason: RefreshTokensRevokeReason, exceptFamilyId?: string): Promise<void> {
    const query = this.refreshRepository
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where("user_id = :userId AND revoked_at IS NULL", { userId });
    if (exceptFamilyId) query.andWhere("family_id <> :exceptFamilyId", { exceptFamilyId });
    await query.execute();
  }

  signChallenge(userId: string): string {
    return this.jwt.sign(
      { sub: userId, purpose: "2fa" },
      { secret: appConfig.env.JWT_ACCESS_SECRET, expiresIn: 300 },
    );
  }

  verifyChallenge(token: string): string {
    try {
      const payload = this.jwt.verify(token, { secret: appConfig.env.JWT_ACCESS_SECRET });
      if (payload.purpose !== "2fa") throw new Error("wrong purpose");
      return payload.sub;
    } catch {
      throw new UnauthorizedException("Login challenge is invalid or expired. Log in again.");
    }
  }
}
