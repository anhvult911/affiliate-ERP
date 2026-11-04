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

/** Default lookup: `.env.local` wins over `.env`, matching Next.js' own order. */
export function defaultEnvPaths(cwd = process.cwd()): string[] {
  return [`${cwd}/.env.local`, `${cwd}/.env`, `${cwd}/workers/.env.local`, `${cwd}/workers/.env`];
}
