import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { Page } from "playwright";

import { WorkerApi } from "../api.js";
import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { firstPage, launchBrowser, resolveProvider } from "../providers/index.js";
import { assertProxyReachable } from "../proxy-check.js";

/**
 * Manual login check for one account.
 *
 *   pnpm --filter affiliate-worker login-check --account=<uuid> [--check-only] [--no-proxy]
 *
 * Opens the account's profile, goes to Facebook and — unless `--check-only` — signs
 * in with the imported password and a freshly generated TOTP code. It never posts
 * anything; its only output is a verdict plus an evidence screenshot, because the
 * question it answers ("can this account still log in from this machine?") cannot
 * be answered from the queue.
 *
 * One attempt per invocation on purpose: repeated failed logins are what turns a
 * checkpoint into a lockout.
 */

type Verdict =
  | { status: "logged_in"; detail: string }
  | { status: "needs_2fa"; detail: string }
  | { status: "checkpoint"; detail: string }
  | { status: "captcha"; detail: string }
  | { status: "wrong_credentials"; detail: string }
  | { status: "unknown"; detail: string };

const EMAIL = 'input[name="email"], #email';
const PASSWORD = 'input[name="pass"], #pass';
// The current login page renders the submit control as an <input type="submit">
// inside a <div role="button">; there is no <button> element at all, which is why
// `button[name="login"]` matches nothing.
const LOGIN_BUTTON = [
  'input[type="submit"]',
  '[data-testid="royal_login_button"]',
  'div[role="button"]:has-text("Đăng nhập")',
  'div[role="button"]:has-text("Log in")',
  'button[name="login"]'
].join(", ");
// Facebook has shipped several 2FA layouts; the newest one is a plain numeric
// input with no name, so the selector list has to be generous.
const TOTP_FIELDS = [
  'input[name="approvals_code"]',
  "#approvals_code",
  'input[autocomplete="one-time-code"]',
  'input[name="twofactor_code"]',
  'input[inputmode="numeric"]',
  'input[aria-label*="mã"]',
  'input[aria-label*="code"]'
];
const TOTP_SUBMIT = [
  '#checkpointSubmitButton',
  'input[type="submit"]',
  'div[role="button"]:has-text("Tiếp")',
  'div[role="button"]:has-text("Continue")',
  'button[type="submit"]'
].join(", ");

async function main(): Promise<void> {
  const accountId = readArg("account");
  if (!accountId) {
    throw new Error("Usage: login-check --account=<uuid> [--check-only]");
  }

  const checkOnly = process.argv.includes("--check-only");
  // Explicit, never implicit: the operator decides to browse from the host IP
  // (e.g. the account's proxy is dead and they want to know if the account still
  // works at all). A silent fallback to the host IP is what bans accounts.
  const noProxy = process.argv.includes("--no-proxy");
  const config = loadConfig();
  const logger = createLogger({
    worker: "login-check",
    provider: config.provider,
    dryRun: config.dryRun
  });

  const api = new WorkerApi(config);
  const credentials = await api.credentials(accountId);

  logger.info("credentials loaded", {
    account: credentials.name,
    identifier: credentials.identifier,
    hasTotp: credentials.totp !== null,
    proxy: credentials.proxy ? `${credentials.proxy.host}:${credentials.proxy.port}` : null
  });

  if (config.provider !== "local") {
    logger.warn("only the local provider is wired for this check", { provider: config.provider });
  }

  if (noProxy && credentials.proxy) {
    logger.warn("--no-proxy: browsing from the host IP, NOT the account's proxy", {
      proxy: `${credentials.proxy.host}:${credentials.proxy.port}`
    });
  }

  // Fail before launching a browser if the proxy is down: Chromium would otherwise
  // fall back to the host IP, which is the one thing that gets accounts banned.
  if (!noProxy && credentials.proxy) {
    await assertProxyReachable(`${credentials.proxy.host}:${credentials.proxy.port ?? ""}`);
  }

  const provider = resolveProvider(config);
  const session = await provider.openProfile({
    profileId: accountId,
    proxy: noProxy ? null : credentials.proxy ? proxyString(credentials) : null,
    logger
  });

  const browser = await launchBrowser(session, logger);

  try {
    const page = await firstPage(browser.context);
    const verdict = await drive(page, credentials, checkOnly, logger);

    await mkdir(config.evidenceDir, { recursive: true });
    const shot = resolve(config.evidenceDir, `login-${accountId.slice(0, 8)}-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

    console.log(JSON.stringify({ ...verdict, url: page.url(), screenshot: shot }, null, 2));
    process.exitCode = verdict.status === "logged_in" ? 0 : 2;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function drive(
  page: Page,
  credentials: Awaited<ReturnType<WorkerApi["credentials"]>>,
  checkOnly: boolean,
  logger: ReturnType<typeof createLogger>
): Promise<Verdict> {
  await page.goto("https://www.facebook.com/?locale=vi_VN", {
    waitUntil: "domcontentloaded",
    timeout: 90_000
  });
  await page.waitForTimeout(3_000);

  const state = await classify(page);
  logger.info("start page", { url: page.url(), state });

  if (state === "two_factor") {
    logger.warn("2FA page on load", await describePage(page));
  }

  if (state === "logged_in") return { status: "logged_in", detail: "Đã có session — không cần đăng nhập." };
  if (state === "two_factor") {
    return { status: "needs_2fa", detail: "Session đã vào tới bước 2FA; chạy lại không cần --check-only để nhập mã." };
  }
  if (state === "checkpoint") return { status: "checkpoint", detail: "Facebook đang chặn bằng checkpoint ngay từ đầu." };
  if (state === "captcha") return { status: "captcha", detail: "Facebook yêu cầu captcha." };

  if (checkOnly) {
    return { status: "unknown", detail: "Chưa đăng nhập (đang ở --check-only, không điền credential)." };
  }

  await page.fill(EMAIL, credentials.identifier);
  await page.waitForTimeout(400 + Math.random() * 600);
  await page.fill(PASSWORD, credentials.password);
  await page.waitForTimeout(300 + Math.random() * 500);

  // Enter submits the real form; the visible control is only a fallback for
  // layouts where Enter is swallowed by a script.
  await page.press(PASSWORD, "Enter").catch(() => {});
  await page.waitForTimeout(2_500);

  if (await isVisible(page, EMAIL)) {
    await page.locator(LOGIN_BUTTON).first().click({ timeout: 10_000 }).catch(() => {});
  }

  await page.waitForTimeout(6_000);

  await page.waitForTimeout(2_000);

  if ((await classify(page)) === "two_factor") {
    logger.info("2FA page ready", await describePage(page));
  }

  // The current 2FA page renders the code input with no name and a generated id,
  // so the generic visible-text-input fallback is the one that actually matches.
  const onTwoFactor = (await classify(page)) === "two_factor";
  const totpField = onTwoFactor
    ? (await firstVisible(page, TOTP_FIELDS)) ?? (await firstVisible(page, ['input[type="text"]']))
    : null;
  if (!totpField) {
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll("input")].map((element) => ({
        name: element.name,
        id: element.id,
        type: element.type,
        autocomplete: element.autocomplete,
        inputmode: element.getAttribute("inputmode")
      }))
    );
    logger.warn("2FA page has no recognised code input", { url: page.url(), inputs });
  }

  if (totpField) {
    if (!credentials.totp) {
      return { status: "needs_2fa", detail: "Facebook hỏi 2FA nhưng account không có TOTP secret." };
    }

    logger.info("2FA prompt", { secondsRemaining: credentials.totp.secondsRemaining, field: totpField });
    await page.fill(totpField, credentials.totp.code);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(2_000);

    if (await isVisible(page, totpField)) {
      await page.locator(TOTP_SUBMIT).first().click({ timeout: 8_000 }).catch(() => {});
    }

    await page.waitForTimeout(6_000);

    if ((await classify(page)) === "remember_browser") {
      const saveButton = page
        .locator('div[role="button"]:has-text("Lưu trình duyệt"), div[role="button"]:has-text("Save browser"), [aria-label*="Lưu trình duyệt"]')
        .first();
      if (await saveButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
        logger.info("accepting the remember-browser prompt");
        await saveButton.click().catch(() => {});
        await page.waitForTimeout(6_000);
      } else {
        logger.warn("remember-browser prompt shown but no save button was found");
      }
    }
  }

  let after = await classify(page);
  if (after === "remember_browser") {
    await page.waitForTimeout(5_000);
    after = await classify(page);
  }

  logger.info("after login", { url: page.url(), state: after });

  switch (after) {
    case "logged_in":
      return { status: "logged_in", detail: "Đăng nhập thành công, session đã lưu vào profile." };
    case "two_factor":
      return { status: "needs_2fa", detail: "Vẫn ở bước 2FA — mã chưa được chấp nhận." };
    case "remember_browser":
      return {
        status: "needs_2fa",
        detail: "Mã đã đúng, nhưng chưa bấm được 'Lưu trình duyệt' — chạy lại để hoàn tất."
      };
    case "checkpoint":
      return { status: "checkpoint", detail: "Checkpoint — cần người thật xử lý trong GUI." };
    case "captcha":
      return { status: "captcha", detail: "Captcha — cần người thật giải." };
    case "login_form": {
      const error = await page
        .locator('[role="alert"], ._9ay7, #error_box')
        .first()
        .innerText({ timeout: 2_000 })
        .catch(() => "");
      return {
        status: "wrong_credentials",
        detail: error.trim() || "Vẫn ở form đăng nhập — sai mật khẩu hoặc bị chặn."
      };
    }
    default:
      return { status: "unknown", detail: `Không rõ trạng thái (${page.url()}).` };
  }
}

type PageState =
  | "logged_in"
  | "login_form"
  | "two_factor"
  | "remember_browser"
  | "checkpoint"
  | "captcha"
  | "unknown";

async function classify(page: Page): Promise<PageState> {
  const url = page.url();
  // Reached only after Facebook accepted the password + code.
  if (/remember_browser/.test(url)) return "remember_browser";
  if (/two_step_verification|\/two_factor/.test(url)) return "two_factor";
  if (/\/(checkpoint|challenge)/.test(url)) return "checkpoint";
  if (await isVisible(page, '#captcha, [data-testid="captcha"]')) return "captcha";

  if (await isVisible(page, EMAIL)) return "login_form";

  const loggedInMarkers = [
    'a[href*="/me/"]',
    'div[role="navigation"] a[href="/friends/"]',
    'a[aria-label*="Trang cá nhân"]',
    'a[aria-label*="Your profile"]'
  ];

  for (const marker of loggedInMarkers) {
    if (await isVisible(page, marker)) return "logged_in";
  }

  return "unknown";
}

/** Everything a human would read on a challenge page: text, inputs, buttons. */
async function describePage(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    url: location.href.split("?")[0],
    text: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 700),
    inputs: [...document.querySelectorAll("input")].map((element) => ({
      name: element.name,
      id: element.id,
      type: element.type,
      inputmode: element.getAttribute("inputmode"),
      autocomplete: element.autocomplete,
      visible: (element as HTMLElement).offsetParent !== null
    })),
    buttons: [...document.querySelectorAll('[role="button"], button, input[type="submit"]')]
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .slice(0, 8)
      .map((element) => (element.textContent ?? (element as HTMLInputElement).value ?? "").trim().slice(0, 40))
  }));
}

async function firstVisible(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    if (await isVisible(page, selector)) return selector;
  }
  return null;
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .isVisible({ timeout: 1_500 })
    .catch(() => false);
}

function proxyString(credentials: { proxy: { host: string; port: number | null; username: string | null; password: string | null } | null }): string | null {
  const proxy = credentials.proxy;
  if (!proxy || !proxy.port) return null;
  return proxy.username
    ? `${proxy.host}:${proxy.port}:${proxy.username}:${proxy.password ?? ""}`
    : `${proxy.host}:${proxy.port}`;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : null;
}

await main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "error", detail: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
