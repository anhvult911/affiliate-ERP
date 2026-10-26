import { decodeBase32 } from "@/lib/accounts/totp";

/**
 * Parser for the operator's Facebook export, one account per line:
 *
 *   uid|password|2FA-secret|proxy
 *   00000000000000|matkhau|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|127.0.0.1:8080
 *
 * (Fixture values. A real export must never reach the repository — see
 * docs/REVIEW.md P0-1 and `pnpm check:secrets`.)
 *
 * The proxy may be `host:port` (no auth) or `host:port:user:pass`. The 2FA field is
 * the secret behind https://2fa.live — base32, so it can be turned into a 6-digit
 * code locally (see `src/lib/accounts/totp.ts`) instead of calling that site.
 *
 * Parsing is pure and returns issues per line, because a batch import must never
 * abort halfway: 9 good lines out of 10 should still land.
 */

export type ParsedProxy = {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
};

export type ParsedAccount = {
  /** 1-based line number in the pasted text, for error messages. */
  line: number;
  identifier: string;
  password: string;
  twofaSecret: string;
  proxy: ParsedProxy | null;
};

export type ParseIssue = { line: number; error: string };

export type ParseResult = {
  accounts: ParsedAccount[];
  issues: ParseIssue[];
};

const MAX_LINES = 50;

export function parseAccountLines(input: string): ParseResult {
  const accounts: ParsedAccount[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();

  const lines = input.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const trimmed = rawLine.trim();

    if (trimmed.length === 0 || trimmed.startsWith("#")) return;

    if (accounts.length >= MAX_LINES) {
      issues.push({ line, error: `Chỉ nhập tối đa ${MAX_LINES} account mỗi lần.` });
      return;
    }

    const parts = trimmed.split("|").map((part) => part.trim());

    if (parts.length < 3) {
      issues.push({
        line,
        error: "Thiếu trường. Định dạng: uid|mật khẩu|2FA secret|proxy (proxy có thể bỏ trống)."
      });
      return;
    }

    const [identifier = "", password = "", twofaSecret = "", proxyPart = ""] = parts;

    if (!/^[A-Za-z0-9._@-]{3,120}$/.test(identifier)) {
      issues.push({ line, error: `UID/email không hợp lệ: "${identifier}".` });
      return;
    }

    if (password.length < 4) {
      issues.push({ line, error: "Mật khẩu quá ngắn." });
      return;
    }

    if (!isBase32(twofaSecret)) {
      issues.push({
        line,
        error: "2FA secret phải là chuỗi base32 (A–Z, 2–7), ít nhất 16 ký tự."
      });
      return;
    }

    const proxy = proxyPart.length > 0 ? parseProxy(proxyPart) : null;
    if (proxyPart.length > 0 && !proxy) {
      issues.push({
        line,
        error: `Proxy không hợp lệ: "${proxyPart}". Dùng host:port hoặc host:port:user:pass.`
      });
      return;
    }

    const key = identifier.toLowerCase();
    if (seen.has(key)) {
      issues.push({ line, error: `Trùng UID với một dòng phía trên (${identifier}).` });
      return;
    }

    seen.add(key);
    accounts.push({ line, identifier, password, twofaSecret, proxy });
  });

  return { accounts, issues };
}

export function parseProxy(value: string): ParsedProxy | null {
  const parts = value.split(":").map((part) => part.trim());

  if (parts.length !== 2 && parts.length !== 4) return null;

  const [host = "", portRaw = "", username = "", password = ""] = parts;

  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return null;

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  if (parts.length === 4 && (username.length === 0 || password.length === 0)) return null;

  return {
    host,
    port,
    username: parts.length === 4 ? username : null,
    password: parts.length === 4 ? password : null
  };
}

function isBase32(value: string): boolean {
  const cleaned = value.replace(/[\s-]/g, "").replace(/=+$/, "");
  if (cleaned.length < 16) return false;

  try {
    return decodeBase32(cleaned).length >= 10;
  } catch {
    return false;
  }
}

/** Display name for an imported login, since the export carries no nickname. */
export function defaultAccountName(identifier: string): string {
  const tail = identifier.length > 6 ? identifier.slice(-6) : identifier;
  return `FB ${tail}`;
}
