/**
 * Secret scanning for the pre-commit hook.
 *
 * The repository is public and its first commit already contained a real
 * `uid|password|2FA|proxy` line (docs/REVIEW.md P0-1). Deleting that line does not
 * remove it from history, so the only durable fix is to stop the next one from
 * being committed: this module is the check, and `scripts/check-secrets.ts` runs it
 * over staged files.
 *
 * It is intentionally narrow. A generic entropy detector flags hashes, UUIDs and
 * base64 fixtures and gets disabled within a week; these are the shapes that
 * actually appear in this repo's data (Facebook exports, Google/Telegram tokens,
 * authenticated proxies, Supabase JWTs).
 *
 * Pure functions only — the CLI does file traversal, the tests call `scanText`
 * directly.
 */

export type SecretKind =
  | "account-export-line"
  | "base32-secret"
  | "proxy-credentials"
  | "supabase-jwt"
  | "telegram-bot-token"
  | "google-api-key";

export type SecretFinding = {
  /** 1-based line number inside the scanned text. */
  line: number;
  kind: SecretKind;
  /** Enough context to find the line, never the whole secret. */
  preview: string;
};

type Rule = {
  kind: SecretKind;
  pattern: RegExp;
  /** Pulls the suspicious value out of a match so it can be redacted. */
  value: (match: RegExpMatchArray) => string;
};

const RULES: Rule[] = [
  {
    // The operator's export format: uid|password|2FA|proxy
    kind: "account-export-line",
    pattern: /\b\d{10,17}\|([^|\n]{4,64})\|([A-Z2-7]{16,64})(?:\|(\S+))?/g,
    value: (match) => match[0] ?? ""
  },
  {
    // A TOTP secret on its own — 32 base32 chars is the standard length.
    kind: "base32-secret",
    pattern: /\b[A-Z2-7]{32,64}\b/g,
    value: (match) => match[0] ?? ""
  },
  {
    // host:port:user:pass, i.e. a proxy that can actually be used.
    kind: "proxy-credentials",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}:[^\s:|'"`]+:[^\s:|'"`]+/g,
    value: (match) => match[0] ?? ""
  },
  {
    kind: "supabase-jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    value: (match) => match[0] ?? ""
  },
  {
    kind: "telegram-bot-token",
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g,
    value: (match) => match[0] ?? ""
  },
  {
    // Both the classic AIza… key and the newer AQ.… key shape.
    kind: "google-api-key",
    pattern: /\b(?:AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{20,})\b/g,
    value: (match) => match[0] ?? ""
  }
];

/**
 * Values that only exist as documentation.
 *
 * `AAAAAAAA…` is the fixture the review prescribed, `matkhau` is "password" in
 * Vietnamese, and `127.0.0.1` proxies have no credentials to steal.
 */
const FAKE_MARKERS = [
  /^0+$/,
  /^A+$/,
  /^X+$/,
  /matkhau/i,
  /example/i,
  /placeholder/i,
  /redacted/i,
  /^change-me/i,
  /^your-/i
];

const ALLOW_MARKER = "secret-scan:allow";

function looksFake(value: string): boolean {
  const compact = value.replace(/[^A-Za-z0-9]/g, "");
  if (compact.length === 0) return false;
  if (FAKE_MARKERS.some((marker) => marker.test(value) || marker.test(compact))) return true;

  // Every character the same ("AAAA…") is a fixture, never a real secret.
  return new Set(compact).size === 1;
}

/** `value` shortened so a finding never reproduces the secret. */
function redact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "***";
  return `${trimmed.slice(0, 4)}…(${trimmed.length} chars)`;
}

/**
 * Scans one text blob. Lines carrying `secret-scan:allow` are skipped, which is how
 * documentation explains a pattern without tripping the hook.
 */
export function scanText(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return;

    for (const rule of RULES) {
      // A fresh regex per line keeps lastIndex from leaking between lines.
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null = pattern.exec(line);

      while (match) {
        const value = rule.value(match);

        if (value.length > 0 && !looksFake(value)) {
          findings.push({ line: index + 1, kind: rule.kind, preview: redact(value) });
          break; // one finding per rule per line is enough to block the commit
        }

        match = pattern.exec(line);
      }
    }
  });

  return findings;
}

/** File types worth scanning: text sources, config templates and docs. */
export const SCANNED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".json",
  ".md",
  ".sql",
  ".toml",
  ".yml",
  ".yaml",
  ".env",
  ".example",
  ".txt"
];

export function shouldScan(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");

  if (
    /(?:^|\/)(?:node_modules|\.next|\.git|\.profiles|\.evidence|evidence|assets)\//.test(normalized)
  ) {
    return false;
  }

  // Real environment files must never be committed at all; scanning them is moot.
  if (/(?:^|\/)\.env(?:\.[\w-]+)?$/.test(normalized)) return false;
  if (/\.(png|jpe?g|webp|ico|svg|png|woff2?|ttf|pdf|zip)$/i.test(normalized)) return false;

  return SCANNED_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}
