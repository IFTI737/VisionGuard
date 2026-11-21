import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";

export const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

/** A 6-digit code, e.g. "042917". */
export const sixDigitCode = (): string =>
  randomInt(0, 1_000_000).toString().padStart(6, "0");

/** URL-safe random string. */
export const randomToken = (bytes = 24): string =>
  randomBytes(bytes).toString("base64url");

export const safeEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

/** Signs a small JSON payload: "<base64url(json)>.<hmac>". Used for media links. */
export const signPayload = (payload: object, secret: string): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
};

export const verifyPayload = <T = any>(token: string, secret: string): T | null => {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
};
