import type { Json } from "@/lib/database.types";
import type { WarmingKind } from "@/lib/db-types";
import { asSchedule } from "@/lib/json";

/**
 * Schedule maths for the warming worker.
 *
 * The operator writes `persona_schedule` in *their* local time ("09:30"), so the
 * conversion to UTC happens here, once, instead of being smeared across the
 * worker. Everything else in the system is UTC.
 */

export const DEFAULT_WARMING_TIMEZONE = "Asia/Ho_Chi_Minh";
export const DEFAULT_GRACE_MINUTES = 90;

export function warmingTimezone(): string {
  return process.env.WARMING_TIMEZONE?.trim() || DEFAULT_WARMING_TIMEZONE;
}

/**
 * How long a failed profile_setup blocks a retry.
 *
 * Long by default: the dressing step touches the public profile, so a broken
 * selector must not become a loop. Lower it while fixing selectors.
 */
export function profileSetupRetryMinutes(): number {
  const raw = Number(process.env.PROFILE_SETUP_RETRY_MINUTES?.trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 30;
}

export function warmingGraceMinutes(): number {
  const raw = Number(process.env.WARMING_GRACE_MINUTES?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GRACE_MINUTES;
}

export type LocalMoment = { date: string; minutes: number };

/** Wall-clock date + minutes-since-midnight in the warming timezone. */
export function localMoment(instant: Date, timezone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(instant);

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number(value("hour")) % 24;

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: hour * 60 + Number(value("minute"))
  };
}

/** Offset of `timezone` at `instant`, in milliseconds. */
function offsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(instant);

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));

  return asUtc - instant.getTime();
}

/** The UTC instant of `date` at `HH:MM` wall-clock time in `timezone`. */
export function zonedToUtc(date: string, minutes: number, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Bad local date "${date}"`);

  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  // Two passes: the first offset is computed from a guess that may sit on the
  // wrong side of a DST boundary.
  const first = guess - offsetMs(new Date(guess), timezone);
  const second = guess - offsetMs(new Date(first), timezone);

  return new Date(second);
}

export function parseTimeOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export type DueSlot = {
  /** "HH:MM" as the operator wrote it. */
  at: string;
  kind: WarmingKind;
  /** UTC instant the slot opened. */
  slotStart: Date;
};

const WARMING_KINDS = ["lifestyle_post", "cross_warm"] as const;

/** The schedule is operator-authored text; anything else is ignored, not guessed at. */
function isWarmingKind(kind: string): kind is WarmingKind {
  return (WARMING_KINDS as readonly string[]).includes(kind);
}

/**
 * Which scheduled slots are actionable right now.
 *
 * A slot is due when its time has passed, it is still inside the grace window
 * (so a worker that starts at noon does not replay the whole morning) and it has
 * not been executed since it opened.
 */
export function dueSlots(
  schedule: Json | null | undefined,
  options: {
    now: Date;
    timezone: string;
    graceMinutes: number;
    /** Executed runs, newest first — used to skip slots already done. */
    runs: { kind: string; executedAt: string }[];
  }
): DueSlot[] {
  const entries = asSchedule(schedule);
  const moment = localMoment(options.now, options.timezone);
  const due: DueSlot[] = [];

  for (const entry of entries) {
    if (!isWarmingKind(entry.kind)) continue;

    const minutes = parseTimeOfDay(entry.at);
    if (minutes === null) continue;

    const slotStart = zonedToUtc(moment.date, minutes, options.timezone);
    const slotEnd = new Date(slotStart.getTime() + options.graceMinutes * 60_000);

    if (options.now < slotStart || options.now > slotEnd) continue;

    const alreadyDone = options.runs.some(
      (run) => run.kind === entry.kind && new Date(run.executedAt) >= slotStart
    );
    if (alreadyDone) continue;

    due.push({ at: entry.at, kind: entry.kind, slotStart });
  }

  return due;
}
