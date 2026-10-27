import { existsSync, readFileSync } from "node:fs";

/**
 * Environment loading for the CLI scripts (docs/TASKS.md P3-2..P3-5, fixed here).
 *
 * The scripts each had their own loop over `process.loadEnvFile`, which led to a real
 * mis-verification: `smoke` loaded `.env.production` first, `loadEnvFile` never
 * overwrites a key that is already set, so the "local" smoke test was silently talking
 * to the cloud project and reporting `supabase fetch failed` on a machine where the
 * local stack was perfectly healthy.
 *
 * This helper makes the rules explicit:
 *   - file order is precedence, first value wins;
 *   - a key already present in `process.env` always wins over every file (so
 *     `CRON_SECRET=... pnpm smoke` works);
 *   - it reports which file supplied a key, so a script can print what it is testing.
 */

export type LoadedEnv = {
  /** file → number of keys it contributed */
  files: { file: string; keys: number }[];
  /** key → file that supplied it (only for keys taken from a file) */
  sources: Map<string, string>;
};

const PLACEHOLDER = /^(your-|change-me|replace-me|123456:replace-me|\.\.\.)/i;

/** True for the values shipped in .env.example, which can never be credentials. */
export function isPlaceholderValue(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDER.test(value.trim());
}

function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip one layer of matching quotes, and an inline comment that survives it.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(" #");
      if (comment >= 0) value = value.slice(0, comment).trim();
    }

    values.set(key, value);
  }

  return values;
}

/**
 * Loads the first file that defines each key, without overriding `process.env`.
 * `files` may contain paths that do not exist; they are skipped.
 */
export function loadScriptEnv(
  files: string[],
  env: Record<string, string | undefined> = process.env
): LoadedEnv {
  const loaded: LoadedEnv = { files: [], sources: new Map() };

  for (const file of files) {
    if (!existsSync(file)) continue;

    let values: Map<string, string>;
    try {
      values = parseEnvFile(readFileSync(file, "utf8"));
    } catch {
      continue;
    }

    let contributed = 0;
    for (const [key, value] of values) {
      // process.env first, then file order: a later file must not shadow an earlier one.
      if (env[key] !== undefined) continue;
      env[key] = value;
      loaded.sources.set(key, file);
      contributed += 1;
    }

    loaded.files.push({ file, keys: contributed });
  }

  return loaded;
}

/** Files in the order a *local* verification should prefer them. */
export const LOCAL_ENV_FILES = [".env.local", ".env.production", ".env"];

/** Files in the order a *production* check should prefer them. */
export const PRODUCTION_ENV_FILES = [".env.production", ".env.local", ".env"];
