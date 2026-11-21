import z, { ZodError } from "zod";
import * as dotenv from "dotenv";
import { fromZodError } from "zod-validation-error";
dotenv.config();

// Every environment variable the API reads. Anything marked optional() has a
// working fallback, so the server starts on a laptop with only the database,
// Redis and the two JWT secrets set.
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().default(5001),
    PUBLIC_API_URL: z.string().optional(),
    FRONTEND_URL: z.string().default("http://localhost:3000"),

    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().optional(),

    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.coerce.number().default(900), // seconds (15 minutes)
    JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),

    // Email. Without MAILER_HOST the mail is printed in the server log instead.
    MAILER_HOST: z.string().optional(),
    MAILER_PORT: z.coerce.number().default(587),
    MAILER_SECURE: z.coerce.boolean().default(false),
    MAILER_USER: z.string().optional(),
    MAILER_PASSWORD: z.string().optional(),
    MAILER_FROM: z.string().default("VisionGuard <no-reply@visionguard.local>"),
    // Development only: return one-time codes in the API response (field "devCode")
    // so Postman can finish the flow without a mailbox.
    EXPOSE_DEV_CODES: z.coerce.boolean().optional(),

    // Telegram. Without a token, Telegram deliveries are recorded as "failed: not configured".
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().default("dev-telegram-secret"),

    // Browser push (VAPID keys). Without them push deliveries are recorded as failed.
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default("mailto:admin@visionguard.local"),

    // Voice calls. "mock" needs no account: Postman plays the phone (POST /v1/dev/mock-voice/:ref).
    VOICE_PROVIDER: z.enum(["mock"]).default("mock"),
    // Payments. "sandbox" needs no account: Postman plays the gateway.
    PAYMENT_WEBHOOK_SECRET: z.string().default("dev-payment-secret"),

    STORAGE_DIR: z.string().default("storage"), // customer media; never served publicly
    MEDIA_TOKEN_SECRET: z.string().default("dev-media-secret-change-me"),
  })
  .transform((envs) => ({
    ...envs,
    PUBLIC_API_URL: envs.PUBLIC_API_URL || `http://localhost:${envs.PORT}`,
    EXPOSE_DEV_CODES: envs.EXPOSE_DEV_CODES ?? envs.NODE_ENV !== "production",
    REDIS_URL: envs.REDIS_PASSWORD
      ? `redis://:${envs.REDIS_PASSWORD}@${envs.REDIS_HOST}:${envs.REDIS_PORT}`
      : `redis://${envs.REDIS_HOST}:${envs.REDIS_PORT}`,
  }));

const env = (() => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof ZodError)
      throw new Error(`ENV ${fromZodError(error).message}`);
    else throw new Error(`ENV ${error}`);
  }
})();

export const appConfig = {
  default_schema_identifier: "public",
  default_migrations_folder: __dirname + "/../database/migrations",
  env,
};
