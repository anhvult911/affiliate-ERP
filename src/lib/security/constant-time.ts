import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for bearer secrets.
 *
 * Both sides are hashed first, so the comparison is always over 32 bytes: a plain
 * `===` (or an early length check) leaks how much of a guess matched, which is the
 * one thing an attacker can measure on a shared-secret endpoint.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which is why the
 * digests are used instead of the raw strings.
 */
export function secureCompare(candidate: string, expected: string): boolean {
  const left = createHash("sha256").update(candidate, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(left, right);
}

/** `Authorization: Bearer <token>` → token, or "" when absent/malformed. */
export function readBearerToken(header: string | null | undefined): string {
  if (!header) return "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return "";
  return header.slice(prefix.length).trim();
}
