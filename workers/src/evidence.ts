import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "playwright";

import type { Logger } from "./logger.js";

/**
 * Evidence screenshots. Both flows (task execution and persona warming) keep a
 * picture of what the browser actually showed — it is the only artefact that
 * settles "did it post or not" after the fact.
 */
export async function captureScreenshot(
  options: { evidenceDir: string; namePrefix: string; logger: Logger },
  page: Page,
  label: string
): Promise<string | null> {
  try {
    await mkdir(options.evidenceDir, { recursive: true });
    const path = join(options.evidenceDir, `${options.namePrefix}-${label}-${Date.now()}.png`);
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch (error) {
    options.logger.warn("screenshot failed", { error: String(error) });
    return null;
  }
}
