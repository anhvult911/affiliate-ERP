# TASKS — Bảng việc duy nhất (single source of truth)

> **Luật**: tick `[x]` = đã nhận (ghi tên + ngày bên dưới ô). Không tick = chưa ai nhận.
> Chi tiết/AC: link tới REVIEW.md / SHOPEE_API.md. Owner: **PM** = chủ repo, **OC** = OpenCode, **HR** = Hermes.
> Thứ tự: Mục A (PM, blocking) → B (code gấp) → C (Shopee) → D (nên làm) → E (docs/HR).

## A. Của PM — làm trước, không ủy quyền được

- [ ] **P0-ROT-1** — Xoay ngay credential FB trong REVIEW.md P0-1: đổi mật khẩu, reset 2FA, đăng xuất mọi phiên (tài khoản trong README:247 + mọi acc dùng chung proxy) — **PM**
- [ ] **P0-ROT-2** — Quyết định xử lý git history (xóa-tạo repo vs BFG purge) — **PM** (OC chờ xác nhận mới được rewrite history)
- [ ] **P0-ROT-3** — Xoay `TELEGRAM_WEBHOOK_SECRET` + xác nhận secret强度 sau khi repo public (REVIEW §3.7) — **PM**
- [ ] **OPEN-Q** — Trả lời 8 open questions trong REVIEW.md §3 (đánh số 1–8) — **PM**
  - [ ] Q1 credential có thật? / Q2 số worker? / Q3 tuổi task tối đa (đề xuất 7 ngày)? / Q4 quota Gemini?
  - [ ] Q5 local post thật có chủ đích? / Q6 Vercel plan vs ~1.440 heartbeat/ngày? / Q7 verify Telegram mức nào? / Q8 mức chấp nhận rủi ro ToS + số acc/cmd?
- [ ] **SHOPEE-CRED** — Xin App ID/Secret Shopee Affiliate Open API (dashboard affiliate → Open API) — **PM** → mở khoá T-SHOPEE-04..08, 11

## B. Code gấp (OpenCode)

- [ ] **P0-1** — Gỡ dòng `uid|pass|2FA|proxy` khỏi `README.md:247`, `credential-format.ts:7`, placeholder trong `import-accounts-dialog.tsx:23-24`; thay fixture giả; thêm pre-commit secret scan — **OC** *(chờ P0-ROT-1 xong để PM xác nhận giá trị đã xoay)*
- [ ] **P1-1** — `authorizeWorker` → constant-time compare (theo pattern `src/lib/cron/auth.ts`) — **OC** — AC: `auth.ts` không còn `!==` so token; test mới
- [ ] **P1-2** — Sửa claim: tối đa 1 task/account/lần claim (`row_number() partition by assigned_account_id`) — **OC** — AC: verify-schema pass + test "một claim chỉ lấy 1 task/account"; vượt limit 7+25 phải fail test
- [ ] **P1-3** — Radar: xoay vòng account quét (sắp theo `last_action_at`), ngân sách vòng quét/ngày, alert N vòng 0-post liên tiếp — **OC**
- [ ] **P1-4** — TTL task `queued`: quá tuổi (N=7 ngày, chờ Q3) → `failed`/`last_error="stale post"`; hiện tuổi bài khi duyệt — **OC** *(chờ Q3)*
- [ ] **P1-5** — Cron dọn `running` quá lease + `attempt_count>=3` → `failed` + Telegram alert; tách "worker stale" khỏi "task stuck" — **OC**

## C. Shopee integration (OpenCode — spec trong SHOPEE_API.md)

- [ ] **T-SHOPEE-01** — Env & quy trình xin credential — **PM/OC** *(mở đầu, không cần credential)*
- [ ] **T-SHOPEE-02** — GraphQL client + signing SHA256 — **OC**
- [ ] **T-SHOPEE-03** — Smoke probe `scripts/shopee-probe.ts` — **OC**
- [ ] **T-SHOPEE-05** — Migration products extra columns — **OC**
- [ ] **T-SHOPEE-04** — Product sync job — **OC** ⛔ chờ SHOPEE-CRED
- [ ] **T-SHOPEE-06** — Short link per task (subIds[0]) — **OC** ⛔
- [ ] **T-SHOPEE-07** — Conversion pull job — **OC** ⛔
- [ ] **T-SHOPEE-08** — Validated report → settled — **OC** ⛔
- [ ] **T-SHOPEE-09** — `affiliate_sync_state` + resume — **OC**
- [ ] **T-SHOPEE-10** — Lịch cron + cấu hình — **OC**
- [ ] **T-SHOPEE-11** — UI nguồn sync — **OC** ⛔
- [ ] **T-SHOPEE-12** — Đối soát pull + reconcile hiện có — **OC**
- [ ] **T-SHOPEE-13** — Rate limit & backoff (mã 10030) — **OC**
- [ ] **T-SHOPEE-14** — README đóng gap #15 — **OC** *(chỉ khi T-SHOPEE-03 chạy credential thật)*

## D. Nên làm sau (OpenCode — chi tiết REVIEW.md §2 P2)

- [ ] **P2-1** Guard local-posting: code hoá thật hoặc sửa docs (REVIEW P2-1)
- [ ] **P2-2** `.env.example` đồng bộ model default (P2-2)
- [ ] **P2-3** Telegram webhook allowlist `chat.id` (P2-3)
- [ ] **P2-4** Negative cache `radar_seen` cho bài dưới ngưỡng (P2-4)
- [ ] **P2-5** Dry-run không đốt task thật (P2-5)
- [ ] **P2-6** `trust_score` update atomic (P2-6)
- [ ] **P2-7** Server tự set `executed_at` (P2-7)
- [ ] **P2-8** Sửa lệch tài liệu README/MASTER_PROMPT (P2-8)
- [ ] **P2-9** Đưa assertion rls/postback vào `verify-schema.mjs` + test route (REVIEW §4.8)

## E. Docs & review (Hermes)

- [x] **DOC-1** — `docs/REVIEW.md` — HR — 2026-10-26
- [x] **DOC-2** — `docs/SHOPEE_API.md` — HR — 2026-10-26
- [x] **DOC-3** — `docs/COLLAB.md`, `docs/AGENTS.md`, `docs/TASKS.md` — HR — 2026-10-26
- [x] **DOC-4** — Review PR các task B & C khi OC gửi — HR — 2026-10-26 (24/24 PR review static + APPROVE)
- [ ] **DOC-5** — Cập nhật TASKS + spec sau khi PM trả lời OPEN-Q — HR

## 6.11 SESSION-2 CLOSE-OUT (2026-10-26, HR)

**TẤT CẢ PR ĐÃ MERGE — 0 open PR, main CI xanh (full suite: typecheck + test + verify-schema).**

Timeline merge cuối:
- #15 CI-1, #16 P2-1, #17 P2-2
- #2–#5, #7 (P0/P1/T-SHOPEE-01); stacked-base bug → auto-close 4 PR → recovery **#25 (P1-3)** + **#26 (full Shopee chain)** — cả 2 merged, inventory xác nhận đủ 7 file `src/lib/shopee/` + đủ migrations
- **#27** hotfix: union-resolve cắt mất backtick đóng template ở verify-schema.mjs (line 602) → SyntaxError; fix 1 dòng
- Batch 2: **#18 (P2-3), #19 (P2-5), #21 (P2-7), #20 (P2-6), #22 (P2-4), #23 (P2-8)**
- **#24 (P2-9)** compose tay: postback route gộp `readPostbackBody` × `applyConversion` (auto-merge 2 hunk khác vùng, union verify-schema) — CI xanh 28s

Ghi chú kỹ thuật cho lần sau (HR):
1. **Union-resolve KHÔNG được cắt template literal** — đã xảy ra 2 lần (verify-schema line 602, config.ts mất phẩy line 182). Gate cứng: `node --check` + typecheck CI trước khi merge.
2. Clone có refspec theo `main` → **fetch đúng nhánh PR** trước khi checkout/push.
3. `gh pr checks` exit != 0 khi **pending** ≠ "no checks" — phân biệt rõ trước khi STOP.

**Bước kế tiếp (PM + Orca):**
- [ ] PM: `.env` local + credentials từ browser_vault (Supabase, Gemini, Shopee, Telegram) → chạy `npm run verify:schema` local với `--seed`
- [ ] PM: cấu hình `target_sources` thật (groups/KOL/niche) cho radar
- [ ] Orca: deploy workers lên VPS + đăng ký cron (30' sync, hourly reconcile, weekly review) — cần env `WORKER_SHARED_SECRET`/`TELEGRAM_BOT_TOKEN`
- [ ] Demo end-to-end: sync → radar → generate → approval → comment → postback → report

## 6.12 SESSION-3 CLOSE-OUT (2026-10-26, HR)

**Round 3 (P3-1..5) MERGE XONG — 5/5: #28 deploy artifacts + /health + xvfb, #29 smoke, #30 e2e demo, #31 preflight, #32 import targets. CI main xanh.**

- Docs mới: `docs/TESTING.md` (Path A local / Path B cloud smoke / Path C VPS), `docs/DEPLOY.md` (runbook mkt-hk-test: Docker + GPM Linux + VNC + monitor RAM bảo vệ trippool).
- Lessons round 3: union-resolve trên package.json **không dùng được** → thay bằng resolver semantic (`resolve_pkg.py` v2: rebuild scripts block, dedupe key); CI "no checks" retry loop của merge-batch2.sh hoạt động ổn định — tái sử dụng.
- PM env status: Telegram ✅ Gemini ✅ Supabase Seoul ✅ tokens ✅ — còn Shopee App ID/Secret (đang chờ duyệt).

## 6.13 SESSION-4 CLOSE-OUT (2026-10-27, HR)

**Round 4 (P5-1..4) MERGE XONG — #36 deal channel, #37 3 cron Shopee, #38 telegram:webhook, #39 short link. 0 open PR, CI main xanh.**

- Tool giờ **khép kín bằng code**: radar → match → draft → duyệt Telegram → comment → postback → sync tiền → deal channel tự đăng (preview mặc định, nút Đăng/Bỏ qua).
- vercel.json đủ 6 cron: health*/10, reconcile*/30, shopee products/conversions/validated, deal-poster 11:30+20:30 VN.
- T-SHOPEE-04/07/08 đã có route (credential-gated skip 200); T-SHOPEE-06 đã làm (P5-4) — chờ SHOPEE-CRED để chạy thật.
- PM còn lại (ngoài code): Shopee App ID/Secret, Telegram channel + bot admin + TELEGRAM_CHANNEL_ID, deploy VPS theo docs/DEPLOY.md.

---
*Cập nhật lần cuối: 2026-10-27 (HR) — SESSION-4 CLOSE-OUT.*
