# Affiliate Automation ERP — In-house Affiliate Automation & Social Hub

In-house system for one operator: discover products, watch Facebook groups/KOLs,
draft contextual comments with Gemini, run an account farm with persona warming,
execute human-like seeding through an antidetect browser, and attribute revenue
back to the exact comment via Sub_ID.

Spec and product decisions: [`MASTER_PROMPT.md`](./MASTER_PROMPT.md).

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4, shadcn-style primitives on Radix, Lucide icons |
| Data | Supabase — Postgres, pgvector, RLS, Realtime |
| AI | Google Gemini (`@google/genai`) — match scoring, drafting, 768-dim embeddings |
| Workers | External (Python/Node + Playwright) driving GPM-Login/Genlogin through the bearer-token API in `src/app/api/worker/*` |

## Modules

| # | Module | Route | Data |
|---|---|---|---|
| 1–2 | Accounts, personas, trust score, warming | `/accounts`, `/accounts/[id]` | `social_accounts` |
| 3 | Radar watchlist | `/radar`, `/radar/[id]` | `target_sources` |
| 4 | Affiliate hub & product pool | `/products`, `/products/[id]` | `products` |
| 5 | AI contextual engine | `/ai` | `lib/ai/*`, `/api/ai/draft` |
| 5–6 | Approval queue & execution | `/queue` | `comment_tasks` |
| 7 | Analytics & ROI by Sub_ID | `/analytics` | `affiliate_conversions`, `v_task_roi`, `v_account_performance` |

## Getting started

```bash
pnpm install
cp .env.example .env.local     # fill in the values below
pnpm dev
```

Required environment (see `.env.example`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server client. Without these the app renders a setup screen instead of the dashboard. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role access for `/api/worker/*` and `/api/postback/*` only. |
| `GEMINI_API_KEY` | Match scoring, drafting, embeddings. Optional at build time — the AI surfaces show an "unconfigured" state. |
| `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` | Defaults `gemini-3.1-flash-lite` (measured: the 3.5/3.8 flash tiers answered 503 while this one answered in 1.7s; the code falls back across a chain), and `gemini-embedding-001` with `outputDimensionality: 768` — must match `products.embedding`. `text-embedding-004` and `gemini-2.5-flash` are retired for new keys. |
| `WORKER_API_TOKEN` | Bearer token shared with the automation worker (`openssl rand -hex 32`). |
| `RADAR_MATCH_THRESHOLD` | Minimum match score to enqueue a post (default `0.8`). |
| `AFFILIATE_SUB_ID_PARAM` | Query parameter used to append the Sub_ID to affiliate links (default `sub_id`). |

### Local Supabase

The Supabase CLI is a devDependency, so the `db:*` scripts work without `npx`:

```bash
pnpm db:start               # local stack (Docker required)
pnpm db:reset               # applies supabase/migrations/* then supabase/seed.sql
pnpm db:types               # regenerate src/lib/database.types.ts
```

`supabase/seed.sql` loads a realistic Vietnamese demo set: four accounts
(healthy, second healthy persona, cooling down, checkpointed), four radar
sources, five products, one task per status — including a fully actionable 2-tier
seeding task — and three conversions.

### Bootstrap the operator account

Auth is open to any Supabase user, but **RLS only exposes rows to allowlisted
operators** (`public.is_operator()`):

```sql
insert into public.operators (user_id, email)
select id, email from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;
```

Sign-in succeeds only for allowlisted users; everyone else is signed back out
with an explicit message.

On the local stack, the whole bootstrap is two HTTP calls (no `psql` needed):

```bash
API=http://127.0.0.1:54321; SR=<SERVICE_ROLE_KEY from `pnpm exec supabase status -o env`>
UID=$(curl -s -X POST "$API/auth/v1/admin/users" -H "apikey: $SR" -H "Authorization: Bearer $SR" \
  -H "content-type: application/json" \
  -d '{"email":"op@local.test","password":"localdev123","email_confirm":true}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
curl -s -X POST "$API/rest/v1/operators" -H "apikey: $SR" -H "Authorization: Bearer $SR" \
  -H "content-type: application/json" -H "Prefer: return=representation" \
  -d "{\"user_id\":\"$UID\",\"email\":\"op@local.test\"}"
```

`pnpm db:reset` wipes `auth.users` (and therefore the operator row) — re-run this
after a reset.

### Verifying a running local stack

```bash
pnpm exec supabase db advisors --local            # expect: No issues found
pnpm exec supabase db lint --local                # expect: No schema errors found

# RLS + worker-RPC grants against the real stack (multi-statement script → psql
# inside the DB container; `db query -f` cannot run one).
docker cp supabase/ci/rls_check.sql supabase_db_AFFILIATE_AUTOMATION_ERP:/tmp/rls_check.sql
docker exec supabase_db_AFFILIATE_AUTOMATION_ERP \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/rls_check.sql
```

`supabase/config.toml` disables two containers this project does not use
(`edge_runtime`, `analytics`) — the edge runtime's health check also aborts
`supabase start` on some machines.

### Cloud project

```bash
pnpm db:push        # or paste supabase/migrations/20261020090000_init_schema.sql
                    # into the Supabase SQL editor
```

## Schema notes

`supabase/migrations/20261020090000_init_schema.sql` is the single source of
truth. Decisions that differ from the original brainstorm, and why:

- `products.embedding` is `vector(768)` (Gemini `gemini-embedding-001` with `outputDimensionality: 768`), not 1536.
- `comment_tasks` has `unique (post_url)`: a re-scan cannot draft the same post twice.
  Ingest normalises URLs (`src/lib/worker/url.ts`) before the uniqueness check.
- `comment_tasks.secondary_account_id` backs `execution_mode = 'seeding_2_accounts'`,
  enforced by a check constraint.
- `comment_tasks` carries `match_score`, `claimed_at` / `claimed_by` / `attempt_count`,
  `last_error`, `approved_at`, `review_note` and a unique `sub_id_code` so the
  queue is a real work queue (claim is atomic, attribution is joinable).
- `affiliate_conversions.external_order_id` is unique: postback replays update
  instead of double-counting revenue. `task_id` stays nullable for postbacks that
  arrive before the Sub_ID can be resolved.
- `claim_comment_tasks()` uses `FOR UPDATE SKIP LOCKED` so two workers can never
  publish the same comment.
- `match_products()` is the pgvector pre-filter used before Gemini re-ranks.

## Worker API (bearer `WORKER_API_TOKEN`)

| Endpoint | Purpose |
|---|---|
| `POST /api/worker/radar/ingest` | Post a raw capture: normalises the URL, retrieves candidates (pgvector → Gemini), scores, and writes `comment_tasks` as `pending_approval`. Optionally drafts the comment. |
| `GET /api/worker/radar/sources` | Watchlist entries past their `scan_interval_mins` (interval math stays server-side). |
| `POST /api/worker/radar/scanned` | Advances `last_scanned_at`, so an empty or fully-duplicated scan does not stay at the head of the due list. |
| `GET /api/worker/accounts/scan` | Healthiest active accounts with a browser profile — the ones the radar may browse with. |
| `GET /api/worker/accounts/{id}/credentials` | Decrypted login material for one account: password, a live 6-digit TOTP code (RFC 6238) and the proxy parts. Bearer-token only — never rendered in the UI. |
| `GET /api/worker/accounts` | Account farm inventory (antidetect profile id, proxy, persona schedule, trust score). |
| `POST /api/worker/tasks/claim` | Atomically claim queued tasks; returns the comment, the image to attach, the account and the Sub_ID-tracked affiliate URL. |
| `POST /api/worker/tasks/{id}/report` | Terminal callback: `completed`/`failed`, error text, account health (`active`/`cooldown`/`checkpoint`) and cooldown minutes. |
| `POST /api/worker/products/embed` | Backfill `products.embedding`. |
| `POST /api/postback/shopee` | Order postback keyed by `sub_id` + `order_id` (idempotent). |
| `GET|POST /api/cron/reconcile` | Attributes orders that landed before their task had a Sub_ID. Safe to repeat; schedule every 15–30 minutes. |

Example:

```bash
curl -X POST http://localhost:3000/api/worker/tasks/claim \
  -H "authorization: Bearer $WORKER_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"worker":"vps-01","limit":3}'
```

## Mobile-first UI rules

- `lg` and up: sidebar + split-view approval queue (list left, workspace right).
- Below `lg`: sticky top bar with a navigation sheet, a four-slot bottom tab bar
  (Queue, Products, Accounts, Analytics), stacked single-column cards.
- Every interactive target is at least 44px (`min-h-11`, `Button size="icon"|"block"`,
  an invisible `after:` hit area on `Switch`); forms open as bottom sheets;
  safe-area padding via `pb-safe`/`px-safe`.
- Status colours come only from `components/patterns/status-badge.tsx` and label
  maps in `src/lib/constants.ts`, so a state looks identical in every module.

## Realtime

`RealtimeTasksListener` (mounted once in the `(app)` layout) subscribes to
`comment_tasks` and pushes new captures into the queue with a toast.

Two things it must get right, both handled in that component:

- **The channel has to join with the operator's JWT.** Joining as `anon` succeeds
  and then RLS filters every row — the subscription looks healthy and never fires.
  The listener hydrates the session and calls `realtime.setAuth()` before
  subscribing, and re-applies the token on auth state changes.
- **A dead subscription must be visible.** The queue header shows a
  `RealtimeBadge` (`Live` / `Connecting…` / `Updates offline`) fed by
  `components/queue/realtime-status.ts`, and failures are logged and toasted once.

`comment_tasks` and `affiliate_conversions` are added to the `supabase_realtime`
publication by the migration.

## Telegram — approvals and alerts on the phone

The web app is where you *work*; Telegram is where you get *told*. It removes the
two silent failure modes of a solo operation: a capture waiting for someone to
open a dashboard, and a worker that died without anyone noticing.

What it does:

- **New capture** → a message with the AI draft inline and buttons
  `✅ Duyệt & chạy` / `🚫 Từ chối` / `🔍 Mở trong app`. Approving runs the *same*
  server action the dashboard runs, so the Sub_ID and account rules are identical.
- **Failure / account health** → an alert with the source, account, error text and
  links to the task and the accounts page. A checkpoint or a dead worker reaches
  you without you looking for it.
- **Commands**: `/queue` (five oldest pending, each with its own approve/reject
  buttons), `/status` (queue counts, accounts by state, last worker activity).

### Setup

1. `@BotFather` → `/newbot` → copy the token.
2. Message the bot once, then read your chat id:
   `https://api.telegram.org/bot<token>/getUpdates` → `result[0].message.chat.id`.
3. Fill `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`
   (`openssl rand -hex 32`) and `NEXT_PUBLIC_SITE_URL` (used in button links).
4. Register the webhook (Telegram must be able to reach the URL — on localhost use
   a tunnel such as `cloudflared tunnel --url http://localhost:3000`):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{"url":"https://<your-domain>/api/telegram/webhook",
       "secret_token":"<TELEGRAM_WEBHOOK_SECRET>",
       "allowed_updates":["message","callback_query"]}'
```

Without a token the notifiers skip silently; without
`TELEGRAM_WEBHOOK_SECRET` the webhook route answers `503` and refuses to act —
an open webhook would let anyone approve posts on your accounts.

### Verifying without credentials

`TELEGRAM_API_BASE` can point the outbound path at a local stub, which is how the
message text, inline keyboards and callback answers are asserted; the webhook and
the database stay real. That is how this module was verified: `/queue` produced
the digest with per-task buttons, an `approve:<id>` callback moved the task to
`queued` with a fresh Sub_ID, `reject:<id>` set `review_note`, and both the
capture and failure notifiers produced the expected payloads.

## Importing accounts

`/accounts` → **Nhập account** takes the Facebook export, one line per account:

```
uid|password|2FA-secret|proxy
61590750336672|vuongkaitlin25l|GDS7FIVALRCIHH7Y7Y62FNOOUVLT37B5|103.166.184.92:16008:hma27:hma27
```

The proxy field is optional and may be `host:port` or `host:port:user:pass`.
Passwords, TOTP secrets and proxy passwords are encrypted with AES-256-GCM before
insert (`ACCOUNT_CREDENTIALS_KEY`, required — the import refuses to run without it),
and the 6-digit code is generated locally from the secret, so no request ever goes
to 2fa.live. Importing the same UID twice is reported as a duplicate instead of
creating a second persona; the whole paste is not rolled back by one bad line.

`pnpm --filter affiliate-worker login-check --account=<uuid>` verifies that the
account can still log in (password + a fresh TOTP code, no posting) and stores the
session in its local Chrome profile. Details: [`workers/README.md`](./workers/README.md).

`GET /api/worker/accounts/{id}/credentials` is how the worker signs a profile in:
it returns the password, a code valid for the current 30-second window, and the
proxy parts — behind the worker bearer token only.

### Forms and Server Actions

Every form calls its action from `onSubmit` through `useFormAction`
(`src/lib/hooks/use-form-action.ts`), not through React's `<form action>` /
`useActionState` plumbing. In this production build that plumbing delivered the
action — the row really changed — but never applied the returned state: dialogs
stayed open and buttons spun forever. Same root cause as the same-route navigation
issue; both are handled the same way, by not depending on the transition machinery
until it is fixed upstream.

## Volume limits (why the queue is not a firehose)

Every account carries three limits, enforced inside `claim_comment_tasks()` so no
worker can bypass them:

| Column | Default | Meaning |
|---|---|---|
| `daily_comment_limit` | 8 | completed comments per rolling 24h |
| `daily_warming_limit` | 4 | completed warming actions per rolling 24h |
| `min_action_gap_minutes` | 20 | minimum spacing between any two actions |

A task whose persona is saturated stays `queued` — it is not lost, just waiting.
The warming cycle applies the same rules (`src/lib/warming/due.ts`) and hands out at
most one action per account per cycle, because a burst of posts is the clearest
automation signal there is. The accounts table shows the budget spent today
(`0/8 comment · 1/4 warming`), and `v_account_daily_usage` is the source for it.

## Importing products

`/products` → **Nhập CSV** takes a Shopee/Lazada affiliate export. The parser reads
the header row and matches aliases (Vietnamese and English), so column order does not
matter; `,`, `;` and tab are all accepted, and quoted fields with commas inside work.

Required: **Tên sản phẩm** and **Link tiếp thị**. Optional: Giá, Tỷ lệ hoa hồng,
Ngành hàng, Item ID (also extracted from the product URL when absent).

Money and percentages are parsed separately on purpose: `890.000đ` is 890,000 (not
890) while `12,5` in the commission column is 12.5%. Duplicates — by affiliate link or
Shopee item id, whether already in the database or earlier in the same file — are
reported per row and skipped, so pasting the same export twice is harmless.

## Shopee Affiliate API (optional)

Products have two ingestion paths: **Nhập CSV** (works today) and, once Shopee grants
API access, a direct sync. The API is the *publisher* GraphQL endpoint
(`open-api.affiliate.shopee.vn/graphql`) — not the seller Open Platform.

```bash
SHOPEE_AFFILIATE_APP_ID="..."
SHOPEE_AFFILIATE_APP_SECRET="..."
```

App ID and Secret are in the affiliate dashboard → **Open API**. Access must be
requested and approved first; until it is, every call returns
`10035 You currently do not have access to the Shopee Affiliate Open API Platform`.
Requests are signed statelessly (`SHA256(appId + timestamp + body + secret)`), so
there is no token to refresh and no rotation flow — losing the secret means asking
Shopee for a new one.

The secret is read from the environment only: it is never logged, never included in
Telegram alerts and never written to the database. `describeShopeeConfig()` is the
only shape allowed in logs.

## Order reconciliation

Affiliate networks report an order the moment it happens, which can be before the task
that produced it has a Sub_ID. Those rows are stored with `task_id = null`; the views
still attribute them by joining on `sub_id`, but the row itself stays unattributed.
`GET /api/cron/reconcile` fills `task_id` where a matching `sub_id_code` now exists,
returns `{ attributed, remaining }`, and never touches a row that is already
attributed. Schedule it beside `/api/cron/health`.

## Radar scanning

`RADAR_ENABLED=true` adds a cycle to the worker: it asks the app which watchlist
sources are due, opens each in the healthiest account's browser profile, extracts
posts and hands every capture to `/api/worker/radar/ingest`. Matching, de-duplication
and queueing stay server-side, so thresholds and prompts change without touching
the process that drives browsers.

```bash
RADAR_ENABLED=true RADAR_SOURCES_PER_CYCLE=3 DRY_RUN=false ANTIDETECT_PROVIDER=gpm pnpm worker:dev
```

A capture that is already queued comes back `duplicate` and creates nothing. A
source whose scan yields nothing still advances `last_scanned_at`, otherwise it
would hold the head of the due list forever. Before `GEMINI_API_KEY` exists, set
`RADAR_PINNED_PRODUCT_ID` to attach every capture to one product (the ingest route
answers 503 when neither a key nor a pinned product is available).

## Persona warming

`WARMING_ENABLED=true` adds a second cycle to the worker: it publishes ordinary
lifestyle posts on the accounts' own timelines and cross-warms them between
accounts — no affiliate link anywhere, because the point is that the account looks
like a person before it is asked to sell.

Schedules live in `social_accounts.persona_schedule` as local wall-clock times
(`[{"at":"09:30","kind":"lifestyle_post"},{"at":"20:00","kind":"cross_warm"}]`).
The app converts them to UTC, applies a grace window and skips slots already run;
the worker only executes what it is handed. Every action lands in `warming_runs`
(content, permalink, target post) and bumps `trust_score`.

```bash
WARMING_ENABLED=true DRY_RUN=false ANTIDETECT_PROVIDER=gpm pnpm worker:dev
```

Before any post, `profile_setup` dresses the account the way a visitor sees it:
avatar, cover and bio from `workers/assets/<persona>/`, verified and screenshotted,
and recorded on the account (`profile_built_at`, `bio`, `avatar_set_at`,
`cover_set_at`). The account page shows a **Hồ sơ công khai** card with the
completion score and exactly what is still missing. Fixture runs are stored with
`sandbox = true` and never rewrite those fields.

`WARMING_TIMEZONE` (default `Asia/Ho_Chi_Minh`) and `WARMING_GRACE_MINUTES`
(default `90`) control the timing. Details and the verification approach:
[`workers/README.md`](./workers/README.md).

## Execution worker

`workers/` is the process that actually posts: it claims queued tasks, drives the
account's antidetect profile, comments, replies with the Sub_ID affiliate link,
and reports the outcome (including account health). See
[`workers/README.md`](./workers/README.md) for the full guide.

```bash
pnpm worker:browsers                              # install Chromium for Playwright
pnpm worker:fixture                               # dry run: real browser, posts nothing
DRY_RUN=false EXECUTOR=fixture pnpm worker:once    # full path against a local test page
DRY_RUN=false ANTIDETECT_PROVIDER=gpm pnpm worker:dev
```

Safety: `DRY_RUN` defaults to `true`, and the worker refuses to post for real with
`ANTIDETECT_PROVIDER=local`. It also checks the account's proxy is reachable
before launching, because a dead proxy makes Chromium fall back to the host IP.

## Verifying the schema without a database server

```bash
pnpm verify:schema     # 26 assertions, ~3s, no Docker, no network
```

Runs `supabase/migrations/*` and `supabase/seed.sql` against a real Postgres
engine (PGlite — Postgres compiled to WebAssembly) and asserts what the app
relies on: constraints/views/functions apply, the analytics RPCs return the
correct money (canceled excluded, unattributed bucketed, series zero-filled to
today), `claim_comment_tasks()` takes work, reclaims a stale lease and refuses
unhealthy accounts or product-less tasks, and the SECURITY DEFINER worker RPCs
are not executable by `anon`/`authenticated`.

Every run prints what it could not cover. **pgvector is not bundled by PGlite**,
so `products.embedding`, its HNSW index and `match_products()` are filtered out
and must be checked on a pgvector-enabled Postgres:

```bash
docker run -d --name affiliate-erp-pg -p 55432:5432 \
  -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16
docker cp supabase/ci/supabase_shim.sql affiliate-erp-pg:/tmp/shim.sql
docker cp supabase/migrations/20261020090000_init_schema.sql affiliate-erp-pg:/tmp/init.sql
docker cp supabase/seed.sql affiliate-erp-pg:/tmp/seed.sql
docker cp supabase/ci/rls_check.sql affiliate-erp-pg:/tmp/rls_check.sql
docker exec affiliate-erp-pg psql -U postgres -v ON_ERROR_STOP=1 \
  -f /tmp/shim.sql -f /tmp/init.sql -f /tmp/seed.sql -f /tmp/rls_check.sql
```

`supabase/ci/supabase_shim.sql` provides only what Supabase normally supplies
(`auth` schema, `auth.uid()`, the three roles, `supabase_realtime`, and the
function/table default privileges that make the RPC-grant assertions meaningful)
so the migration and the RLS assertions run anywhere. `rls_check.sql` fails
loudly if a non-operator can read or write a domain table, and if `anon` or
`authenticated` can execute a worker RPC.
