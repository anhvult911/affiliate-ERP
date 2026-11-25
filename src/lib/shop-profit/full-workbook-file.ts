import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Reads the operator-private paid workbook. Only an absolute path from env is
 * accepted; no request value ever reaches the filesystem.
 *
 * Required env:
 *   SHOP_PROFIT_FULL_WORKBOOK_PATH=/srv/affiliate-private/Sheet-tinh-lai-day-du.xlsx
 * Optional integrity pin:
 *   SHOP_PROFIT_FULL_WORKBOOK_SHA256=<sha256 hex>
 */
const ENV_PATH = "SHOP_PROFIT_FULL_WORKBOOK_PATH";
const ENV_SHA256 = "SHOP_PROFIT_FULL_WORKBOOK_SHA256";
const MIN_BYTES = 10_000;
const MAX_BYTES = 25 * 1024 * 1024;

export type FullWorkbookFailure =
  | "not_configured"
  | "relative_path"
  | "not_xlsx"
  | "missing"
  | "too_small"
  | "too_large"
  | "not_zip"
  | "checksum_mismatch"
  | "read_failed";

export type FullWorkbookStatus =
  | { ready: true; bytes: number }
  | { ready: false; reason: FullWorkbookFailure };

export type FullWorkbookReadResult =
  | { ok: true; data: Buffer; sha256: string }
  | { ok: false; reason: FullWorkbookFailure };

function configuredPath() {
  return process.env[ENV_PATH]?.trim() ?? "";
}

/** Safe for the authenticated page: it reports readiness, never the path. */
export async function inspectFullWorkbook(): Promise<FullWorkbookStatus> {
  const configured = configuredPath();
  if (!configured) return { ready: false, reason: "not_configured" };
  if (!path.isAbsolute(configured)) return { ready: false, reason: "relative_path" };
  if (!configured.toLowerCase().endsWith(".xlsx")) return { ready: false, reason: "not_xlsx" };

  try {
    const info = await stat(configured);
    if (!info.isFile()) return { ready: false, reason: "missing" };
    if (info.size < MIN_BYTES) return { ready: false, reason: "too_small" };
    if (info.size > MAX_BYTES) return { ready: false, reason: "too_large" };
    return { ready: true, bytes: info.size };
  } catch {
    return { ready: false, reason: "missing" };
  }
}

export async function readFullWorkbook(): Promise<FullWorkbookReadResult> {
  const status = await inspectFullWorkbook();
  if (!status.ready) return { ok: false, reason: status.reason };

  try {
    const data = await readFile(configuredPath());
    if (
      data.length < 4 ||
      data[0] !== 0x50 ||
      data[1] !== 0x4b ||
      data[2] !== 0x03 ||
      data[3] !== 0x04
    ) {
      return { ok: false, reason: "not_zip" };
    }

    const sha256 = createHash("sha256").update(data).digest("hex");
    const expected = process.env[ENV_SHA256]?.trim().toLowerCase();
    if (expected && expected !== sha256) return { ok: false, reason: "checksum_mismatch" };

    return { ok: true, data, sha256 };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}
