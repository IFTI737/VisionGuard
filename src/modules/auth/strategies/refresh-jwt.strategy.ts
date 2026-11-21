import { appConfig } from "@/config/app.config";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Request } from "express";
import { Strategy } from "passport-jwt";

export interface RefreshTokenPayload {
  sub: string; // user id
  jti: string; // refresh_tokens.id
  fam: string; // refresh_tokens.family_id
}

export const REFRESH_COOKIE = "vg_rt";

/**
 * Reads the refresh token from the body (Postman, mobile) or the cookie (web app).
 * A token sent on purpose in the body wins over the cookie the browser adds by itself.
 */
export const refreshTokenFromRequest = (req: Request): string | null =>
  req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE] || null;

/** Used by RefreshJwtGuard: checks the refresh token's signature and expiry. */
@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(Strategy, "refresh-jwt") {
  constructor() {
    super({
      jwtFromRequest: refreshTokenFromRequest,
      ignoreExpiration: false,
      secretOrKey: appConfig.env.JWT_REFRESH_SECRET,
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: RefreshTokenPayload) {
    const token = refreshTokenFromRequest(req);
    if (!token) throw new UnauthorizedException("Missing refresh token");
    // The service still has to check the database row (rotation, reuse).
    return { ...payload, token };
  }
}
