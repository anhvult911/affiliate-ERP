import { existsSync } from "node:fs";

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
export function loadEnvFiles(paths: string[], logger?: { info: (message: string, context?: Record<string, unknown>) => void }): string[] {
  const loader = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  if (typeof loader !== "function") {
    // Node < 20.12: no built-in loader. The worker still runs with shell env only.
    return [];
  }

  const loaded: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    loader.call(process, path);
    loaded.push(path);
  }

  if (loaded.length > 0) {
    logger?.info("env files loaded", { files: loaded });
  }

  return loaded;
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
  return [`${root}/.env.local`, `${root}/.env`, `${root}/workers/.env.local`, `${root}/workers/.env`];
}
