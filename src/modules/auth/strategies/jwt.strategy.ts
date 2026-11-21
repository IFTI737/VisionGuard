import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { appConfig } from "@/config/app.config";
import { UserService } from "@/modules/user/user.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  roles: string[];
  tv: number; // users.token_version when the token was made
  jti: string;
  exp: number;
}

/**
 * Used by JwtGuard. passport-jwt has already checked the signature and the
 * expiry when validate() runs. We add three checks that a signature cannot give:
 *   1. the token was not logged out        (Redis key bl:<jti>, sir's blacklist)
 *   2. the user did not "log out everywhere" or change password (token_version)
 *   3. the account is not disabled
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    private readonly redis: RedisCacheService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: appConfig.env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    const blacklisted = await this.redis.getClient().get(`bl:${payload.jti}`);
    if (blacklisted === "blacklisted")
      throw new UnauthorizedException("Session expired or logged out. Please login again.");

    const user = await this.userService.getAuthState(payload.sub);
    if (!user) throw new UnauthorizedException("User no longer exists");
    if (user.status !== "active") throw new UnauthorizedException("Account is disabled");
    if (user.tokenVersion !== payload.tv)
      throw new UnauthorizedException("Session ended. Please login again.");

    // Role comes from the database (cached 60 s), not from the token, so a
    // role change by an admin takes effect at once.
    return { id: payload.sub, email: payload.email, roles: [user.platformRole], jti: payload.jti, exp: payload.exp };
  }
}
