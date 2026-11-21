import { appConfig } from "@/config/app.config";
import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";

/**
 * Sends email through SMTP when MAILER_HOST is set.
 * Without it (a laptop with no mail account) the mail is printed in the
 * server log, so every flow still works during development and the defense.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter = appConfig.env.MAILER_HOST
    ? nodemailer.createTransport({
        host: appConfig.env.MAILER_HOST,
        port: appConfig.env.MAILER_PORT,
        secure: appConfig.env.MAILER_SECURE,
        auth: appConfig.env.MAILER_USER
          ? { user: appConfig.env.MAILER_USER, pass: appConfig.env.MAILER_PASSWORD }
          : undefined,
      })
    : null;

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[MAIL not configured, printing] to=${to} subject="${subject}" text="${text}"`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: appConfig.env.MAILER_FROM, to, subject, text });
    } catch (error) {
      // A mail problem must never break login or an alert.
      this.logger.error(`Mail to ${to} failed: ${error}`);
    }
  }
}
