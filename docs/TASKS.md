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
- [ ] **DOC-4** — Review PR các task B & C khi OC gửi — HR
- [ ] **DOC-5** — Cập nhật TASKS + spec sau khi PM trả lời OPEN-Q — HR

---
*Cập nhật lần cuối: 2026-10-26 (HR). PM chưa tick mục A → các task có ⛔/chờ vẫn đứng.*
