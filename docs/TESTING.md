# Chạy test LOCAL (PC Windows) + trên CLOUD

> Mục tiêu: chứng minh pipeline chạy ĐÚNG trước khi deploy VPS. Ba path, làm lần lượt.

## Path A — Local full loop (offline, miễn phí, làm được ngay)

Chạy **toàn bộ** radar → approval → claim → postback → reconcile trên máy cá nhân, không đụng Facebook/Shopee/Tài khoản thật.

**Prerequisites (cài 1 lần):**
1. Node 22+ và `corepack enable` (pnpm)
2. **Docker Desktop** đang chạy (Windows: bật WSL2 backend)
3. Supabase CLI: repo đã include qua devDependencies — dùng `npx supabase --version` kiểm tra

**Steps:**
```powershell
# trong D:\Projects\AFFILIATE AUTOMATION ERP
pnpm install
copy .env.example .env.local       # cần tối thiểu: WORKER_API_TOKEN (dán giá trị đã sinh)
npx supabase start                 # stack local: db + api + studio (~2 phút lần đầu)
npx supabase db reset              # apply migrations + seed
pnpm demo:e2e
```

**Kỳ vọng:** 7 bước in ra `✓`, kết thúc bằng `DEMO OK`. Chạy lại lần 2 → vẫn OK (demo tự dọn state).

### Path A.2 — Quét toàn bộ API thật (khuyến nghị sau demo)

`demo:e2e` gọi thẳng thư viện; lệnh dưới đây gọi **đúng các route HTTP** mà worker/cron dùng, qua server đang chạy:

```powershell
pnpm build; pnpm start          # terminal 1 — server trên http://localhost:3000
pnpm verify:local               # terminal 2 — 25 check, ~20 giây
```

Phủ: RLS (anon không đọc được), radar ingest + idempotency + negative cache, auto-match bằng
Gemini (khi có `GEMINI_API_KEY`), sinh draft, duyệt → `sub_id`, claim, report (+ trust),
postback 2 lần (không double-count), reconcile, analytics RPC, warming due, health cron,
token sai → 401, và nhánh `CRON_SECRET` ≠ worker token.

**Kỳ vọng:** `25/25 passed`. Nếu thiếu `GEMINI_API_KEY` → 4 check AI in `SKIP`, còn `21/21 passed · 4 skipped`.
Script tự dọn mọi fixture (task/conversion/`radar_seen`/source) và khôi phục `last_action_at`
của account mà nó tạm xoá để test claim.

Nếu `supabase start` fail trên Windows: mở WSL2, cài Docker Engine trong WSL, chạy lại lệnh trong WSL (repo trên `/mnt/d/...`).

## Path B — Cloud smoke (integration thật)

Kiểm tra credential thật trên project **Seoul** đã tạo:

```powershell
# .env.local trỏ cloud (thay key đã copy từ dashboard):
#   NEXT_PUBLIC_SUPABASE_URL=https://jbytsznialxrkemyyvj.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#   SUPABASE_SERVICE_ROLE_KEY=...
#   GEMINI_API_KEY=...   TELEGRAM_BOT_TOKEN=...   TELEGRAM_CHAT_ID=...

npx supabase link --project-ref jbytsznialxrkemyyvj   # nhập DB password đã lưu
npx supabase db push                                  # apply migrations lên cloud
pnpm smoke
```

**Kỳ vọng:**
```
PASS  supabase   jbytsznialxrkemyyvj.supabase.co reachable
PASS  gemini     gemini-3.1-flash-lite answered
FAIL  shopee     missing SHOPEE_AFFILIATE_APP_ID / ...      ← ĐÚNG KHI CHƯA CÓ CRED
PASS  telegram   @ERPconfirmed_bot · chat ••••789
```
Dòng đầu của `smoke` in ra `(env from: ...)` — kiểm tra nó đang trỏ đúng file bạn muốn
(`.env.local` cho local, `.env.production` cho cloud).

→ 3/4 PASS là ổn (Shopee FAIL đến khi có App ID/Secret — không phải lỗi).

⚠️ Path B **không chạy demo:e2e** (demo từ chối cloud để xóa nhầm data). Demo chỉ chạy Path A.

## Path C — Trên VPS sau deploy
Xem `docs/DEPLOY.md`. Tóm tắt: `smoke` trên VPS → `worker:fixture` → 1 profile thật với `DRY_RUN=true` → rồi mới `DRY_RUN=false`.
