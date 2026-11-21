import { AuthUser } from "@/common/interfaces/auth-user.interface";
import { CodeService } from "@/modules/auth/code.service";
import {
  ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResendCodeDto,
  ResetPasswordDto, TwoFactorVerifyDto, VerifyEmailDto,
} from "@/modules/auth/dto/auth.dto";
import { RefreshToken } from "@/modules/auth/entities/refresh-token.entity";
import { RefreshTokenPayload } from "@/modules/auth/strategies/refresh-jwt.strategy";
import { ClientInfo, TokenService } from "@/modules/auth/token.service";
import { User } from "@/modules/user/entities/user.entity";
import { UserService } from "@/modules/user/user.service";
import { RedisCacheService } from "@/providers/cache/redis/redis-cache.service";
import {
  BadRequestException, ConflictException, ForbiddenException, HttpException,
  Injectable, NotFoundException, UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import { IsNull, Repository } from "typeorm";

const MAX_FAILED_LOGINS = 10;
const LOCK_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshRepository: Repository<RefreshToken>,
    private readonly userService: UserService,
    private readonly codes: CodeService,
    private readonly tokens: TokenService,
    private readonly redis: RedisCacheService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) throw new ConflictException("An account with this email already exists");

    const user = await this.userRepository.save(
      this.userRepository.create({
        name: dto.name,
        email,
        passwordHash: await argon2.hash(dto.password), // argon2id by default
      }),
    );
    const devCode = await this.codes.issue(user, "email_verify");
    return {
      user: this.userService.toPublic(user),
      message: "Account created. We sent a 6-digit code to your email.",
      devCode, // only present in development (EXPOSE_DEV_CODES)
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.findByEmailOrFail(dto.email);
    await this.codes.consume(user.id, "email_verify", dto.code);
    await this.userRepository.update({ id: user.id }, { emailVerifiedAt: new Date() });
    return { message: "Email verified" };
  }

  async resendCode(dto: ResendCodeDto) {
    const user = await this.userRepository.findOne({ where: { email: dto.email.toLowerCase() } });
    // Same answer whether the account exists or not.
    const devCode = user ? await this.codes.issue(user, dto.purpose) : undefined;
    return { message: "If the account exists, a new code was sent.", devCode };
  }

  async login(dto: LoginDto, client: ClientInfo) {
    const email = dto.email.toLowerCase();
    const failKey = `loginfail:${email}`;
    const fails = Number((await this.redis.getClient().get(failKey)) ?? 0);
    if (fails >= MAX_FAILED_LOGINS)
      throw new HttpException("Too many failed logins. Try again in 15 minutes.", 429);

    const user = await this.userRepository
      .createQueryBuilder("u")
      .addSelect("u.passwordHash") // hidden by default (select: false)
      .where("u.email = :email", { email })
      .getOne();
    const passwordOk = user ? await argon2.verify(user.passwordHash, dto.password) : false;
    if (!user || !passwordOk) {
      await this.redis.getClient().multi().incr(failKey).expire(failKey, LOCK_SECONDS).exec();
      throw new UnauthorizedException("Wrong email or password");
    }
    if (user.status !== "active") throw new ForbiddenException("Account is disabled");
    await this.redis.getClient().del(failKey);

    if (user.twoFactorEnabled) {
      const devCode = await this.codes.issue(user, "login_2fa");
      return { twoFactorRequired: true, challengeToken: this.tokens.signChallenge(user.id), devCode };
    }
    return this.finishLogin(user, client);
  }

  async verifyTwoFactor(dto: TwoFactorVerifyDto, client: ClientInfo) {
    const userId = this.tokens.verifyChallenge(dto.challengeToken);
    await this.codes.consume(userId, "login_2fa", dto.code);
    const user = await this.userRepository.findOneOrFail({ where: { id: userId } });
    return this.finishLogin(user, client);
  }

  private async finishLogin(user: User, client: ClientInfo) {
    await this.userRepository.update({ id: user.id }, { lastLoginAt: new Date() });
    const pair = await this.tokens.issuePair(user, client);
    return { ...pair, user: this.userService.toPublic(user) };
  }

  async refresh(payload: RefreshTokenPayload & { token: string }, client: ClientInfo) {
    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user || user.status !== "active") throw new UnauthorizedException("Account is not available");
    const pair = await this.tokens.rotate(payload, user, client);
    if (!pair)
      throw new UnauthorizedException("This refresh token was already used. All sessions of this login were closed.");
    return pair;
  }

  async logout(user: AuthUser, refreshToken: string | null) {
    await this.tokens.blacklistAccessToken(user.jti, user.exp);
    await this.tokens.revokeByToken(refreshToken, "logout");
  }

  async logoutAll(user: AuthUser) {
    await this.userService.bumpTokenVersion(user.id);
    await this.tokens.revokeAllForUser(user.id, "logout_all");
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userRepository.findOne({ where: { email: dto.email.toLowerCase() } });
    const devCode = user ? await this.codes.issue(user, "password_reset") : undefined;
    // Always the same answer, so nobody can test which emails have accounts.
    return { message: "If the account exists, a reset code was sent.", devCode };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userRepository.findOne({ where: { email: dto.email.toLowerCase() } });
    if (!user) throw new BadRequestException("Code is invalid or expired. Request a new one.");
    await this.codes.consume(user.id, "password_reset", dto.code);
    await this.setPassword(user.id, dto.newPassword);
    return { message: "Password changed. Please log in again on every device." };
  }

  async changePassword(authUser: AuthUser, dto: ChangePasswordDto) {
    await this.assertPassword(authUser.id, dto.currentPassword);
    await this.setPassword(authUser.id, dto.newPassword);
    return { message: "Password changed. Please log in again." };
  }

  private async setPassword(userId: string, newPassword: string) {
    await this.userRepository.update({ id: userId }, { passwordHash: await argon2.hash(newPassword) });
    await this.userService.bumpTokenVersion(userId); // every access token dies
    await this.tokens.revokeAllForUser(userId, "password_changed");
  }

  async setTwoFactor(authUser: AuthUser, password: string, enabled: boolean) {
    await this.assertPassword(authUser.id, password);
    await this.userRepository.update({ id: authUser.id }, { twoFactorEnabled: enabled });
    return { twoFactorEnabled: enabled };
  }

  /** My logins (one per device). */
  async listSessions(userId: string) {
    return this.refreshRepository.find({
      where: { userId, revokedAt: IsNull() },
      select: ["id", "userAgent", "ip", "createdAt", "lastUsedAt", "expiresAt"],
      order: { createdAt: "DESC" },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const row = await this.refreshRepository.findOne({ where: { id: sessionId, userId, revokedAt: IsNull() } });
    if (!row) throw new NotFoundException("Session not found");
    await this.refreshRepository.update(
      { familyId: row.familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokeReason: "logout" },
    );
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.userRepository
      .createQueryBuilder("u")
      .addSelect("u.passwordHash")
      .where("u.id = :userId", { userId })
      .getOneOrFail();
    if (!(await argon2.verify(user.passwordHash, password)))
      throw new UnauthorizedException("Wrong password");
  }

  private async findByEmailOrFail(email: string) {
    const user = await this.userRepository.findOne({ where: { email: email.toLowerCase() } });
    if (!user) throw new BadRequestException("Code is invalid or expired. Request a new one.");
    return user;
  }
}
