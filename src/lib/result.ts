import type { ZodError } from "zod";

/**
 * Uniform contract for every Server Action and API route in the app.
 * Callers switch on `ok` and never have to catch.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

export function fromZodError(error: ZodError): ActionResult<never> {
  const fieldErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const flattened: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) flattened[field] = messages;
  }
  const first = Object.values(flattened)[0]?.[0] ?? "Invalid input.";
  return { ok: false, error: first, fieldErrors: flattened };
}

/** Turns any thrown value into a readable message for the UI. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error.";
}
