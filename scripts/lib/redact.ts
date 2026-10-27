/**
 * Redaction helpers for the CLI scripts (docs/TASKS.md P3-2).
 *
 * A smoke test that prints a credential to the terminal defeats the purpose of the
 * secret-scan hook: terminal history, CI logs and pasted screenshots all outlive the
 * run. Only the last four characters are ever shown, which is enough to tell two keys
 * apart and useless to anyone else.
 */

/** `sk_live_ABCDEF1234` → `••••‥1234`. Non-secrets pass through unchanged. */
export function maskSecret(value: string | null | undefined): string {
  if (value === null || value === undefined) return "(unset)";

  const trimmed = value.trim();
  if (trimmed.length === 0) return "(empty)";

  // Short values are masked entirely rather than almost entirely.
  if (trimmed.length <= 8) return "••••";

  return `••••${trimmed.slice(-4)}`;
}

/** Environment presence line: `NAME=••••1234` or `NAME=(unset)`. */
export function describeEnv(name: string, value: string | null | undefined): string {
  return `${name}=${maskSecret(value)}`;
}

/** Host part of a URL, for logs that should not reveal a token-bearing query string. */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "(unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
}
