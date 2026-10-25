/**
 * Structured one-line logs. The worker runs unattended on a VPS, so every line
 * carries the task id it belongs to — that is what makes a failure traceable
 * after the fact.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined;
  return raw && raw in LEVEL_ORDER ? LEVEL_ORDER[raw] : LEVEL_ORDER.info;
}

function emit(level: LogLevel, message: string, fields: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < threshold()) return;

  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);

  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${
    parts.length > 0 ? ` ${parts.join(" ")}` : ""
  }`;

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export type Logger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
};

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return {
    debug: (message, fields = {}) => emit("debug", message, { ...base, ...fields }),
    info: (message, fields = {}) => emit("info", message, { ...base, ...fields }),
    warn: (message, fields = {}) => emit("warn", message, { ...base, ...fields }),
    error: (message, fields = {}) => emit("error", message, { ...base, ...fields }),
    child: (fields) => createLogger({ ...base, ...fields })
  };
}
