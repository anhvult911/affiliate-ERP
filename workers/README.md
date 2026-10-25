# Execution worker

Claims queued comment tasks from the app, publishes them through an antidetect
browser, and reports the outcome back. This is the process that actually posts —
everything in `src/` (the Next.js app) only decides *what* should be posted.

```
claim (atomic, server-side)  →  open the account's antidetect profile
   →  comment (no link) + buyer photo  →  verify it rendered
   →  reply with the Sub_ID affiliate link  →  report + evidence screenshot
```

## Safety defaults

| Rule | Why |
|---|---|
| `DRY_RUN=true` by default | Drives the real browser and the real typing path, then submits nothing. |
| Refuses `ANTIDETECT_PROVIDER=local` when `DRY_RUN=false` | A real comment must come from a warmed, fingerprinted profile. The one exception is `EXECUTOR=fixture`, which only posts to a local test page. |
| Proxy pre-flight before launch | If the proxy is down, Chromium silently falls back to the host IP — the fastest way to get an account linked and banned. |
| One task at a time per process | Parallel posts from one profile is the pattern platforms look for. |
| `checkpoint` is never cleared by the worker | The report API accepts `cooldown`/`checkpoint` only; clearing a checkpoint is a human decision. |

## Requirements

- Node 20.9+ (uses `Promise.withResolvers`, `fetch`, `AbortSignal.timeout`)
- Chromium for Playwright: `pnpm --filter affiliate-worker browsers`
  (set `PLAYWRIGHT_BROWSERS_PATH` first if `C:` is tight — e.g. `D:/ms-playwright`)
- For real runs: GPM-Login or Genlogin installed and running locally

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | The web app. |
| `WORKER_API_TOKEN` | — | **Required.** Must match the app's value. |
| `WORKER_NAME` | `worker-1` | Identity recorded on the claim; reports must come from the same name. |
| `DRY_RUN` | `true` | See above. |
| `ANTIDETECT_PROVIDER` | `local` | `gpm` \| `genlogin` \| `local`. |
| `EXECUTOR` | `facebook` | `facebook` (real) \| `fixture` (local test page). |
| `POLL_INTERVAL_MS` | `15000` | Idle poll cadence. |
| `MAX_PER_CLAIM` | `3` | Tasks claimed per cycle. |
| `GPM_API_URL` / `GENLOGIN_API_URL` | `127.0.0.1:19995` / `:55555` | Local APIs of the antidetect tools. |
| `LOCAL_PROFILE_DIR` | `./.profiles` | Chromium user-data dirs for the `local` provider. |
| `EVIDENCE_DIR` | `./.evidence` | Screenshots taken before/after posting. |
| `FIXTURE_URL` | auto | Fixture page; when unset the worker serves it itself. |
| `RANDOM_SEED` | unseeded | Makes all human-like delays reproducible. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. |

## Running

```bash
# 1. dry run against the real queue — claims, opens a profile, types, posts nothing
DRY_RUN=true EXECUTOR=fixture pnpm --filter affiliate-worker start --once

# 2. full execution path against the local fixture page (safe: it is not Facebook)
DRY_RUN=false EXECUTOR=fixture pnpm --filter affiliate-worker start --once

# 3. production loop
DRY_RUN=false ANTIDETECT_PROVIDER=gpm pnpm --filter affiliate-worker dev
```

`--once` runs a single claim cycle; without it the worker polls until
`SIGINT`/`SIGTERM`, finishing the task in flight before exiting.

## Profile building (the part a visitor sees)

Text warming makes an account *active*; it does not make it look *real*. A profile
with posts but no avatar reads as a farm in under a second, so `profile_setup` runs
first — before any lifestyle post — for every account whose `profile_built_at` is
NULL:

1. upload the persona avatar (`assets/<persona>/avatar.*`)
2. upload the cover (`assets/<persona>/cover.*`)
3. set the intro/bio from the persona templates
4. verify the result as a visitor would see it, and screenshot it

It is throttled to one attempt per six hours so a missing asset cannot become a
retry loop against the platform. The avatar is what marks the profile built; a run
that only sets the cover stays "not built" so it is retried later.

Runs against the local fixture are reported with `sandbox: true` and **never**
rewrite the account's public state — a rehearsal must not make the dashboard claim
work that never touched Facebook.

```bash
WARMING_ENABLED=true DRY_RUN=false ANTIDETECT_PROVIDER=local \
  pnpm --filter affiliate-worker start --once --executor=fixture
```

Asset layout and the rules for choosing photos: [`assets/README.md`](./assets/README.md).
The Facebook-side selectors (avatar/cover/bio) are unverified against a live
account — same caveat as the comment flow; the fixture path is fully verified.

## The `local` provider (no antidetect tool)

`ANTIDETECT_PROVIDER=local` drives the operator's **own Chrome** with one persistent
user-data directory per account (`.profiles/<account-id>`). Cookies and warm-up
history survive between runs, proxies are applied per profile, and profiles are
locked (`.worker.lock`, 30-minute stale window) so two workers can never open the
same account at once.

It requires Google Chrome installed on the machine (`channel: "chrome"`); it is not
Playwright's bundled Chromium. `navigator.webdriver` is false and the UA/fonts/WebGL
are the host's genuine ones.

What it does **not** do: give each account a different fingerprint. Every persona on
the same machine shares the host's canvas/WebGL/audio signature, so accounts can be
linked to each other. Fine for a handful of accounts; at ~5–10 on one box, use a
fingerprint-masking provider (GPM-Login/Genlogin) — that is the only thing it buys.

Check that one account can still log in, without posting anything:

```bash
pnpm --filter affiliate-worker login-check --account=<uuid> [--check-only] [--no-proxy]
```

It prints a verdict (`logged_in`, `needs_2fa`, `checkpoint`, `captcha`,
`wrong_credentials`), writes an evidence screenshot, and exits non-zero unless the
account is logged in. Passwords come from the encrypted store; the TOTP code is
generated for the current 30-second window. `--no-proxy` is explicit on purpose: a
silent fallback to the host IP is how accounts get flagged. There is one login
attempt per invocation — repeated failures are what turn a checkpoint into a lockout.

## Limits the worker cannot bypass

The app enforces per-account volume and rhythm inside `claim_comment_tasks()`:
`daily_comment_limit`, `daily_warming_limit`, `min_action_gap_minutes`. A saturated
persona simply yields nothing to claim, so the worker keeps polling and never has to
know the rules. Warming applies the same limits before handing out slots.

Consequence worth knowing: after a successful action the account is silent for
`min_action_gap_minutes` (default 20) — an empty claim cycle right after a post is
correct behaviour, not a failure.

## Running in a container

```bash
docker build -f workers/Dockerfile -t affiliate-worker .
docker run --env-file workers/.env \
  -v affiliate-profiles:/app/workers/.profiles \
  -v "$PWD/workers/assets:/app/workers/assets:ro" \
  affiliate-worker
```

`BROWSER_CHANNEL` is empty in the image: the container has no system Chrome, so the
worker uses Playwright's Chromium. On a desktop keep the default `chrome` — it is the
better fingerprint, and it is what the verified login was measured on.

What a container cannot do: solve a checkpoint or captcha. It reports the state and
stops (the account is flagged in the dashboard either way), but a human has to open
the profile on a machine with a display. That is the trade-off against running the
worker on the operator's desktop.

`xvfb-run` provides the virtual display headed Chromium needs; without it the browser
cannot start at all.

## Account logins

`api.credentials(accountId)` returns `identifier`, `password`, a live `totp.code`
and the proxy parts for an imported account. Use it when a profile has no session
and Facebook asks for a password/2FA; the code is generated server-side, so a login
always uses one inside the current 30-second window. Secrets never appear in logs —
keep it that way.

## Radar scanning (module 3, first half)

`RADAR_ENABLED=true` adds one more cycle to the same loop: pick the healthiest
active account, ask the app which watchlist sources are past their
`scan_interval_mins`, open each in that account's profile, extract posts and POST
every one to `/api/worker/radar/ingest`.

```
/api/worker/radar/sources    due sources (interval math lives server-side)
/api/worker/accounts/scan    accounts allowed to browse (active + has a profile)
/api/worker/radar/ingest     capture → normalize → dedupe → match → comment_tasks
/api/worker/radar/scanned    advances last_scanned_at even when a scan finds nothing
```

Decisions live in the app, not here: thresholds, prompts and de-duplication change
without redeploying the process that drives browsers. A post already queued is
reported as `duplicate` and never creates a second task.

```bash
# scan one source against the local fixture, pinning a product (no GEMINI_API_KEY needed)
RADAR_ENABLED=true RADAR_SOURCES_PER_CYCLE=1 RADAR_PINNED_PRODUCT_ID=<product-uuid> \
  WARMING_ENABLED=false pnpm --filter affiliate-worker start --once --executor=fixture
```

Without `RADAR_PINNED_PRODUCT_ID`, ingest requires `GEMINI_API_KEY` and answers
503, because auto-matching is the only other way to choose a product.

## What the fixture harness proves — and what it does not

`EXECUTOR=fixture` serves a local page (`fixtures/comment-page.html`) that mirrors
the parts of a Facebook post the worker touches. It is stateful on purpose: two
browser profiles see the same post, which is what makes the 2-tier flow testable.

Proven against a real browser: profile launch, human-like typing/scroll cadence,
comment submission, DOM verification, buyer-photo attachment, the Sub_ID link
reply, 2-tier (tier-2 account replies from its own profile), checkpoint/rate-limit
detection (including Vietnamese walls), evidence screenshots, and every report
path (completed / failed / account health).

**Not covered:** the Facebook selectors themselves and the GPM/Genlogin local
APIs. Both are written against the documented shapes and must be confirmed once
against a live account and your installed tool version — the adapters log the raw
response when they cannot find a websocket endpoint, which is the one-minute fix
for a version change. Re-check `src/execution/facebook.ts` whenever Facebook ships
a redesign; the selectors are deliberately in one file.

## Persona warming (module 2)

`WARMING_ENABLED=true` adds a second cycle to the same process: it asks the app
what is due, then

- **lifestyle_post** — publishes an ordinary post on the account's own timeline and
  records its permalink, so another account can warm it later;
- **cross_warm** — comments on another account's recent lifestyle post, preferring
  the same persona (two decor accounts agreeing reads like a community, not a farm).

Neither carries a link. The affiliate link only ever appears in the execution flow.

The schedule lives in `social_accounts.persona_schedule` as local wall-clock times
(`[{"at":"09:30","kind":"lifestyle_post"}]`), and the **app** converts it to UTC,
applies the grace window (`WARMING_GRACE_MINUTES`, default 90 — so a worker started
at noon does not replay the whole morning) and skips slots already executed. The
worker only executes what it is handed.

```bash
# a dedicated warming process, no task claiming
WARMING_ENABLED=true DRY_RUN=false ANTIDETECT_PROVIDER=gpm pnpm --filter affiliate-worker start --warming-only
```

Every action is logged in `warming_runs` (content, permalink, target post, errors)
and bumps `trust_score` — the same trust number the persona builder uses. A
checkpoint discovered during warming is reported the same way as during execution,
and the worker may never clear one.

Verification with no Facebook account: `EXECUTOR=fixture WARMING_ENABLED=true`
drives the local harness, whose timeline and post views make the cross-account flow
observable. That is how this was verified: a `me_bim` account published a lifestyle
post (permalink read back from the DOM), a `decor` account then cross-warmed that
exact post, both runs landed in `warming_runs`, and both accounts' trust increased.

## Behaviour worth knowing

- **Reply, not comment.** The affiliate link is posted as a reply to the comment,
  never in the comment body — a bare link in the body is what group rules and spam
  filters look for. In `seeding_2_accounts` mode the *tier-2 account* posts that
  reply from its own profile.
- **Partial success is reported, not hidden.** If the comment went out but the
  link reply failed, the task is reported `completed` with an `execution_note`
  ("affiliate link reply failed — fix by hand, do not re-approve this task") so
  the operator sees it in the queue instead of only in the logs.
- **A missing buyer photo is not fatal.** A dead CDN URL costs the photo, not the
  comment; the note records it.
- **Account health wins over the task.** A verification wall detected before or
  during the flow is reported as `accountStatus=checkpoint`, which flips the
  account and (via the claim predicate) stops the queue handing it more work.
- **Lease interplay.** If a report fails to reach the API, the task stays
  `running` until the app's 15-minute lease reclaims it — the worker logs that
  loudly.
