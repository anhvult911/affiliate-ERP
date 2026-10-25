import type { Page } from "playwright";

/**
 * Human-like timing. The point is not to look random for its own sake: uniform
 * machine-speed typing and instant scrolling are the cheapest signals a platform
 * uses to separate automation from a person.
 *
 * Every source of randomness goes through one seeded generator, so a dry run can
 * be replayed exactly (RANDOM_SEED) when investigating a failure.
 */

export type Rng = () => number;

/** mulberry32 — small, fast, and reproducible from a seed. */
export function createRng(seed: number | null): Rng {
  if (seed === null) return Math.random;

  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Pause a human would take while reading before acting. */
export async function readingPause(rng: Rng, scale = 1): Promise<void> {
  await sleep(randomInt(rng, Math.round(600 * scale), Math.round(2200 * scale)));
}

/** Per-character delay, longer after sentence punctuation — mirrors real typing. */
export function typingDelayMs(rng: Rng, previousChar: string): number {
  const base = randomInt(rng, 35, 120);
  const pauseAfterPunctuation = /[.,!?;:]/.test(previousChar) ? randomInt(rng, 120, 420) : 0;
  return base + pauseAfterPunctuation;
}

/**
 * Types into an element one character at a time with human cadence.
 * Uses `pressSequentially` so the page sees real key events (React and Facebook's
 * composer both ignore programmatic value assignment).
 */
export async function typeLikeHuman(page: Page, selector: string, text: string, rng: Rng): Promise<void> {
  const target = page.locator(selector).first();

  // Bounded and explained: waiting 30s for a composer that will never appear
  // (checkpoint wall, layout change) wastes a queue cycle and reports a timeout
  // instead of the real problem.
  const visible = await target.isVisible({ timeout: 15_000 }).catch(() => false);
  if (!visible) {
    throw new Error(
      `Composer "${selector}" never appeared — the page layout changed or the account hit a wall.`
    );
  }

  await target.click();

  for (const char of text) {
    await target.pressSequentially(char, { delay: typingDelayMs(rng, char) });
    if (rng() < 0.04) await sleep(randomInt(rng, 200, 700));
  }
}

/** A few wheel steps with pauses, the way a person scans a feed before replying. */
export async function scrollLikeHuman(page: Page, rng: Rng): Promise<void> {
  const steps = randomInt(rng, 2, 4);

  for (let step = 0; step < steps; step += 1) {
    const delta = randomInt(rng, 180, 520) * (rng() < 0.25 ? -1 : 1);
    await page.mouse.wheel(0, delta);
    await sleep(randomInt(rng, 250, 900));
  }
}

/** Small pointer movements so the session is not a sequence of teleports. */
export async function moveMouseLikeHuman(page: Page, rng: Rng): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const moves = randomInt(rng, 2, 4);

  for (let move = 0; move < moves; move += 1) {
    await page.mouse.move(
      randomInt(rng, 40, Math.max(60, viewport.width - 40)),
      randomInt(rng, 40, Math.max(60, viewport.height - 40)),
      { steps: randomInt(rng, 8, 25) }
    );
    await sleep(randomInt(rng, 80, 320));
  }
}
