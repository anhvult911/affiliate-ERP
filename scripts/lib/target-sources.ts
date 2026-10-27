/**
 * Parser for the target-source import (docs/TASKS.md P3-5).
 *
 * The watchlist is otherwise typed in one row at a time, and a real operation has dozens
 * of groups. JSON for a full export, CSV for a spreadsheet — both end up in the same
 * validated shape.
 *
 * Bad rows are skipped with a reason instead of failing the whole file: a 40-line export
 * with one typo should still import 39 sources.
 */

export const SOURCE_TYPES = ["group", "fanpage", "kol", "forum"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type ParsedTarget = {
  /** 1-based line in the file (JSON: array index + 1) for error messages. */
  line: number;
  name: string;
  url: string;
  source_type: SourceType;
  niche: string | null;
  tone_of_voice: string | null;
  group_rules: string | null;
  scan_interval_mins: number;
  is_active: boolean;
};

export type TargetIssue = { line: number; error: string };

export type TargetParseResult = { targets: ParsedTarget[]; issues: TargetIssue[] };

const MAX_INTERVAL = 1440;
const DEFAULT_INTERVAL = 15;

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normaliseType(value: unknown): SourceType | null {
  const raw = asString(value)?.toLowerCase();
  return raw && (SOURCE_TYPES as readonly string[]).includes(raw) ? (raw as SourceType) : null;
}

function normaliseInterval(value: unknown): number | null {
  const raw = asString(value);
  if (raw === null) return DEFAULT_INTERVAL;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_INTERVAL ? parsed : null;
}

function normaliseActive(value: unknown): boolean {
  const raw = asString(value)?.toLowerCase();
  // `?.` yields undefined for a missing value, not null.
  if (raw === null || raw === undefined) return true;
  return !["false", "0", "no", "off", "inactive"].includes(raw);
}

/** Validates one row. Returns the target or a reason, never both. */
export function parseTargetRow(
  row: Record<string, unknown>,
  line: number
): { target: ParsedTarget } | { error: string } {
  const name = asString(row.name);
  if (!name) return { error: "missing name" };

  const url = asString(row.url);
  if (!url) return { error: "missing url" };
  if (!/^https?:\/\//i.test(url)) return { error: `url must start with http:// or https:// (got "${url.slice(0, 40)}")` };

  const sourceType = normaliseType(row.source_type ?? row.sourceType ?? row.type);
  if (!sourceType) {
    return { error: `source_type must be one of ${SOURCE_TYPES.join(", ")}` };
  }

  const interval = normaliseInterval(row.scan_interval_mins ?? row.scanIntervalMins);
  if (interval === null) return { error: `scan_interval_mins must be 1..${MAX_INTERVAL}` };

  return {
    target: {
      line,
      name,
      url,
      source_type: sourceType,
      niche: asString(row.niche),
      tone_of_voice: asString(row.tone_of_voice ?? row.toneOfVoice),
      group_rules: asString(row.group_rules ?? row.groupRules),
      scan_interval_mins: interval,
      is_active: normaliseActive(row.is_active ?? row.isActive)
    }
  };
}

/** Splits one CSV line, honouring quotes and doubled quotes. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === delimiter) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsv(content: string): TargetParseResult {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { targets: [], issues: [{ line: 1, error: "need a header row and at least one row" }] };

  const headerLine = lines[0] as string;
  const delimiter = (headerLine.match(/;/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitCsvLine(headerLine, delimiter).map((header) => header.toLowerCase().trim());

  const targets: ParsedTarget[] = [];
  const issues: TargetIssue[] = [];

  lines.slice(1).forEach((raw, index) => {
    const line = index + 2;
    const cells = splitCsvLine(raw, delimiter);
    const row: Record<string, unknown> = {};
    headers.forEach((header, position) => {
      if (header) row[header] = cells[position] ?? "";
    });

    const parsed = parseTargetRow(row, line);
    if ("error" in parsed) issues.push({ line, error: parsed.error });
    else targets.push(parsed.target);
  });

  return { targets, issues };
}

function parseJson(content: string): TargetParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { targets: [], issues: [{ line: 1, error: `invalid JSON: ${error instanceof Error ? error.message : "parse error"}` }] };
  }

  const rows = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { sources?: unknown })?.sources) ? (parsed as { sources: unknown[] }).sources : null;
  if (!rows) return { targets: [], issues: [{ line: 1, error: "expected an array of sources (or { \"sources\": [...] })" }] };

  const targets: ParsedTarget[] = [];
  const issues: TargetIssue[] = [];

  rows.forEach((row, index) => {
    const line = index + 1;
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      issues.push({ line, error: "each entry must be an object" });
      return;
    }

    const parsedRow = parseTargetRow(row as Record<string, unknown>, line);
    if ("error" in parsedRow) issues.push({ line, error: parsedRow.error });
    else targets.push(parsedRow.target);
  });

  return { targets, issues };
}

/** Format from the file extension, falling back to the first non-space character. */
export function parseTargetFile(content: string, path: string): TargetParseResult {
  const lower = path.toLowerCase();
  const looksJson = lower.endsWith(".json") || content.trimStart().startsWith("[") || content.trimStart().startsWith("{");

  return looksJson ? parseJson(content) : parseCsv(content);
}

/** Removes duplicates inside one file, keeping the first occurrence. */
export function dedupeTargets(targets: ParsedTarget[]): { unique: ParsedTarget[]; duplicates: TargetIssue[] } {
  const seen = new Map<string, number>();
  const unique: ParsedTarget[] = [];
  const duplicates: TargetIssue[] = [];

  for (const target of targets) {
    const key = target.url.toLowerCase();
    const first = seen.get(key);

    if (first !== undefined) {
      duplicates.push({ line: target.line, error: `duplicate url of line ${first}` });
      continue;
    }

    seen.set(key, target.line);
    unique.push(target);
  }

  return { unique, duplicates };
}
