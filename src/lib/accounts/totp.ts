import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP — the same 6-digit code 2fa.live shows for a secret.
 *
 * Generating it here means the worker can log in without depending on a third-party
 * website: the secret is the input, the code is arithmetic.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** Decodes RFC 4648 base32 (spaces, dashes and padding tolerated). */
export function decodeBase32(input: string): Buffer {
  const cleaned = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (cleaned.length === 0) throw new Error("Empty base32 secret.");

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Not a base32 secret (unexpected "${char}").`);

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export type TotpCode = {
  code: string;
  /** Whole seconds until this code stops being accepted. */
  secondsRemaining: number;
};

export function generateTotp(secret: string, now: number = Date.now()): TotpCode {
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);

  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);

  const digest = createHmac("sha1", key).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;

  // `?? 0` keeps `noUncheckedIndexedAccess` happy; HMAC-SHA1 is always 20 bytes, so
  // offset + 3 is always inside the digest.
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  const code = String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
  const secondsRemaining = TOTP_PERIOD_SECONDS - (Math.floor(now / 1000) % TOTP_PERIOD_SECONDS);

  return { code, secondsRemaining };
}
