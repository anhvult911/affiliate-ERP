import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Secret-at-rest for account credentials.
 *
 * AES-256-GCM, one random IV per value, authenticated (a tampered ciphertext fails
 * instead of decrypting to garbage). The key never touches the database: it lives
 * in `ACCOUNT_CREDENTIALS_KEY`, so a database dump alone does not hand anyone a
 * farm full of logins.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>` — base64url, so it survives JSON and SQL
 * without escaping. The version prefix is what makes rotation possible later.
 */

const KEY_ENV = "ACCOUNT_CREDENTIALS_KEY";
const VERSION = "v1";

export class MissingCredentialsKeyError extends Error {
  constructor() {
    super(
      `${KEY_ENV} is not configured. Generate one with \`openssl rand -hex 32\` and add it to the server environment before importing accounts.`
    );
    this.name = "MissingCredentialsKeyError";
  }
}

function readKey(): Buffer {
  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) throw new MissingCredentialsKeyError();

  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must be 32 bytes (64 hex chars or base64).`);
  }

  return key;
}

export function encryptSecret(plain: string): string {
  const key = readKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

/** Returns null when the value cannot be decrypted (wrong key, tampered, malformed). */
export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null;

  const [version, ivPart, tagPart, dataPart] = encoded.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !dataPart) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", readKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function isCredentialsKeyConfigured(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}
