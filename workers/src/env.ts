import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads the app's env files for the standalone worker process.
 *
 * Next.js reads `.env.local` / `.env.production` for the server, but the worker is a
 * plain `tsx` process: without this it sees only the shell environment, so an operator
 * who fills `.env.local` and runs `pnpm worker:dev` silently gets the defaults
 * (`provider=local`, no token). That failure looks like a config bug, not a missing
 * file, so the loader is explicit about what it did.
 *
 * Node's `process.loadEnvFile` keeps already-set variables, which is the precedence we
 * want: a shell export (or Docker `--env`) beats the file. Called in order, later files
 * never override earlier ones because earlier values are already in the environment.
 */
type EnvLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn?: (message: string, context?: Record<string, unknown>) => void;
};

export function loadEnvFiles(paths: string[], logger?: EnvLogger): string[] {
  const loader = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  if (typeof loader !== "function") {
    // Node < 20.12: no built-in loader. The worker still runs with shell env only.
    logger?.warn?.("this Node has no process.loadEnvFile — worker runs on shell env only", {
      node: process.version
    });
    return [];
  }

  const loaded: string[] = [];
  for (const path of paths) {
    if (!isReadableFile(path)) continue;
    try {
      loader.call(process, path);
      loaded.push(path);
    } catch (error) {
      // A directory named `.env.local`, a permission error or a malformed file must not
      // take down the process before the logger exists — the worker can still run on
      // shell env, and the operator needs to see why the file was ignored.
      logger?.warn?.("env file could not be loaded", { path, error: String(error) });
    }
  }

  if (loaded.length > 0) {
    logger?.info?.("env files loaded", { files: loaded });
  } else {
    // The bug this module exists to fix was silence: say what was searched.
    logger?.warn?.("no env file found — worker is running on shell environment only", {
      searched: paths
    });
  }

  return loaded;
}

/** existsSync() is true for directories too, which makes loadEnvFile throw EISDIR. */
function isReadableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds the workspace root by walking up for a marker only the repo root has.
 *
 * `pnpm --filter affiliate-worker` runs the script with cwd set to `workers/`, so
 * resolving env paths against `process.cwd()` looks for `workers/.env.local` and misses
 * the root `.env.local` the operator actually edited. Both `pnpm-workspace.yaml` and
 * `.git` exist only at the root, while `package.json` exists in both directories and is
 * therefore useless as a marker.
 */
export function findRepoRoot(start = process.cwd(), maxDepth = 6): string {
  let dir = start;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (existsSync(`${dir}/pnpm-workspace.yaml`) || existsSync(`${dir}/.git`)) return dir;
    const parent = dir.replace(/[\\/][^\\/]+$/, "");
    if (parent === dir || parent.length === 0) break;
    dir = parent;
  }
  return start;
}

/** Default lookup: `.env.local` wins over `.env`, matching Next.js' own order. */
export function defaultEnvPaths(cwd = process.cwd()): string[] {
  const root = findRepoRoot(cwd);
  // join(), not template strings: on Windows the separator is `\`, and the worker's own
  // tests compare these paths against path.join() results.
  return [
    join(root, ".env.local"),
    join(root, ".env"),
    join(root, "workers", ".env.local"),
    join(root, "workers", ".env")
  ];
}
