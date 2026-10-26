# TASKS — Bảng việc duy nhất (single source of truth)

> **Luật**: tick `[x]` = đã nhận (ghi tên + ngày bên dưới ô). Không tick = chưa ai nhận.
> Chi tiết/AC: link tới REVIEW.md / SHOPEE_API.md. Owner: **PM** = chủ repo, **OC** = OpenCode, **HR** = Hermes.
> Thứ tự: Mục A (PM, blocking) → B (code gấp) → C (Shopee) → D (nên làm) → E (docs/HR).

## A. Của PM — làm trước, không ủy quyền được

- [x] **P0-ROT-1** — ~~Xoay credential~~ **PM quyết định 2026-10-26: tài khoản trong README là TK TEST → bỏ qua xoay.** Rủi ro chấp nhận: uid/pass/2FA/proxy trong README + git history bị coi là public. Việc còn lại của P0-1 (gỡ dòng, fixture giả, pre-commit scan) **không còn chờ gì** — **PM**
- [x] **P0-ROT-2** — ~~Purge history~~ **PM: bỏ qua**, theo P0-ROT-1 (tk test) — **PM**
- [ ] **P0-ROT-3** — Xoay `TELEGRAM_WEBHOOK_SECRET` + xác nhận độ mạnh secret sau khi repo public (REVIEW §3.7) — **PM**
- [ ] **OPEN-Q** — Trả lời 8 open questions trong REVIEW.md §3 (đánh số 1–8) — **PM**
  - [x] Q1 → **đã trả lời: tk test, chấp nhận public** (P0-ROT-1) / [ ] Q2 số worker? / [x] Q3 → **PM duyệt đề xuất: 7 ngày** (2026-10-26) / [ ] Q4 quota Gemini?
  - [ ] Q5 local post thật có chủ đích? / Q6 Vercel plan vs ~1.440 heartbeat/ngày? / Q7 verify Telegram mức nào? / Q8 mức chấp nhận rủi ro ToS + số acc/cmd?
- [ ] **SHOPEE-CRED** — Xin App ID/Secret Shopee Affiliate Open API (dashboard affiliate → Open API) — **PM** → mở khoá T-SHOPEE-04..08, 11

## B. Code gấp (OpenCode)

- [ ] **P0-1** — Gỡ dòng `uid|pass|2FA|proxy` khỏi `README.md:247`, `credential-format.ts:7`, placeholder trong `import-accounts-dialog.tsx:23-24`; thay fixture giả; thêm pre-commit secret scan — **OC** *(PM xác nhận tk test 2026-10-26 → CHẠY ĐƯỢC NGAY, không chờ)*
- [ ] **P1-1** — `authorizeWorker` → constant-time compare (theo pattern `src/lib/cron/auth.ts`) — **OC** — AC: `auth.ts` không còn `!==` so token; test mới
- [ ] **P1-2** — Sửa claim: tối đa 1 task/account/lần claim (`row_number() partition by assigned_account_id`) — **OC** — AC: verify-schema pass + test "một claim chỉ lấy 1 task/account"; vượt limit 7+25 phải fail test
- [ ] **P1-3** — Radar: xoay vòng account quét (sắp theo `last_action_at`), ngân sách vòng quét/ngày, alert N vòng 0-post liên tiếp — **OC**
- [ ] **P1-4** — TTL task `queued`: quá tuổi **N=7 ngày** (Q3 đã chốt) → `failed`/`last_error="stale post"`; hiện tuổi bài khi duyệt — **OC** *(CHẠY ĐƯỢC NGAY)*
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
- [x] **DOC-4** — Review 13 PR (#2–#14) — HR — 2026-10-26 — **13/13 APPROVE (static)**, comments đã đăng. Thứ tự merge: #5 trước #6 (stacked P1); chuỗi Shopee #8→#9→…→#14 (stacked); **P1-5 + P1-3 merge TRƯỚC chuỗi Shopee** (types file đã regenerate kèm radar/sweep). Cảnh báo deploy ở PR #10 (check dup affiliate_short_link trước khi chạy unique index). Các nit P2 nằm trong comments.
- [ ] **DOC-5** — Cập nhật TASKS + spec sau khi PM trả lời OPEN-Q — HR
- [ ] **DOC-6** — Review các PR kế tiếp (monitor cron lo khi model ổn định lại; nếu cron còn error → PM báo HR review tay) — HR

## F. Hạ tầng (mới — HR đề xuất 2026-10-26)

- [ ] **CI-1** — Thêm `.github/workflows`: `pnpm test` + `pnpm verify:schema` + `pnpm typecheck` trên mỗi PR — **OC** *(hiện repo KHÔNG có CI → merge = không ai chạy test; blocker gián tiếp cho mọi task B/C)*
- [ ] **TEST-RUN-1** — Chạy 1 lần `pnpm test` + `pnpm verify:schema` trên máy có RAM đủ (PM máy Windows hoặc CI sau CI-1) rồi báo HR ghi nhận kết quả vào TASKS — **PM/OC**

---
*Cập nhật lần cuối: 2026-10-26 (HR) — PM xác nhận TK test (Q1) + duyệt TTL 7 ngày (Q3) → P1-4 CHẠY ĐƯỢC NGAY. Vẫn chờ: Q2, Q4–Q8 + SHOPEE-CRED (mở T-SHOPEE-04/06/07/08/11/14).*
