import { sha256, safeEqual, sixDigitCode } from "@/common/helpers/crypto.helper";
import type { AuthCodesPurpose } from "@/common/constants/check-values";
import { appConfig } from "@/config/app.config";
import { AuthCode } from "@/modules/auth/entities/auth-code.entity";
import { User } from "@/modules/user/entities/user.entity";
import { MailService } from "@/providers/mail/mail.service";
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { IsNull, Repository } from "typeorm";

const SUBJECT: Record<AuthCodesPurpose, string> = {
  email_verify: "Verify your VisionGuard email",
  phone_verify: "Verify your phone",
  password_reset: "Reset your VisionGuard password",
  login_2fa: "Your VisionGuard login code",
};

/** One-time 6-digit codes. Only the hash is stored (table auth_codes). */
@Injectable()
export class CodeService {
  constructor(
    @InjectRepository(AuthCode) private readonly codeRepository: Repository<AuthCode>,
    private readonly mail: MailService,
  ) {}

  /** Makes a new code, cancels the previous one, emails it. Returns the code only in development. */
  async issue(user: User, purpose: AuthCodesPurpose): Promise<string | undefined> {
    // only one usable code per user and purpose (also a unique index in the database)
    await this.codeRepository.update(
      { userId: user.id, purpose, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    const id = randomUUID();
    const code = sixDigitCode();
    await this.codeRepository.save(
      this.codeRepository.create({
        id,
        userId: user.id,
        purpose,
        channel: "email",
        target: user.email,
        codeHash: sha256(code + id),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
    );
    await this.mail.send(user.email, SUBJECT[purpose], `Your code is ${code}. It is valid for 10 minutes.`);
    return appConfig.env.EXPOSE_DEV_CODES ? code : undefined;
  }

  /** Throws 400 when the code is wrong, expired or tried too often. */
  async consume(userId: string, purpose: AuthCodesPurpose, code: string): Promise<void> {
    const row = await this.codeRepository
      .createQueryBuilder("c")
      .addSelect("c.codeHash")
      .where("c.userId = :userId AND c.purpose = :purpose AND c.consumedAt IS NULL", { userId, purpose })
      .getOne();
    if (!row || row.expiresAt < new Date())
      throw new BadRequestException("Code is invalid or expired. Request a new one.");
    if (row.attempts >= row.maxAttempts)
      throw new BadRequestException("Too many wrong attempts. Request a new code.");
    if (!safeEqual(row.codeHash, sha256(code + row.id))) {
      await this.codeRepository.increment({ id: row.id }, "attempts", 1);
      throw new BadRequestException("Code is invalid or expired. Request a new one.");
    }
    await this.codeRepository.update({ id: row.id }, { consumedAt: new Date() });
  }
}
