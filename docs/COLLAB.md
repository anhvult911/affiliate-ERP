# COLLAB — Phân vai & luật hợp tác (PM + OpenCode + Hermes)

> Bộ luật làm việc chung cho repo này. Vi phạm → conflict tự xuất hiện.
> Owner của file này: **Hermes agent** (docs/). Đề nghị sửa → issue/PR, không edit trực tiếp.

## 1. Thành phần & vai trò

| Vai trò | Ai | Chịu trách nhiệm |
|---|---|---|
| **PM** | Chủ repo (con người) | Quyết định scope, ưu tiên, rủi ro; **toàn bộ credential** (FB, Shopee, Supabase, Telegram); duyệt deploy; trả lời Open questions | 
| **OpenCode (OC)** | Coding agent | Viết code cho các task được claim trong `docs/TASKS.md`; test; commit/PR |
| **Hermes (HR)** | Agent review/spec | `docs/` (review, spec, research, bảng task); review PR; research API; acceptance criteria. **Không commit vào code của OC** |

## 2. Vùng sở hữu file (1 file = 1 owner)

- **PM**: secrets/env, quyết định trong `docs/TASKS.md` mục A, setting repo.
- **OC**: `src/`, `workers/`, `supabase/migrations/`, `tests/`, `package*.json`, config app.
- **HR**: toàn bộ `docs/` — kể cả file này.
- Không ai sửa file của người khác "tiện thể". Cần đổi → ghi vào PR/issue, owner sửa.

## 3. Quy trình 1 task

1. Task phải có ô checkbox trong `docs/TASKS.md` (spec = single source of truth).
2. OC nhận task → **tick checkbox + ghi tên/ngày** → mở nhánh `task/<ID>` (vd `task/P1-1`).
3. Commit format: `P1-1: mô tả` (ID đứng đầu).
4. Xong → PR → **HR review** → PM duyệt → merge. Chưa ai tick = chưa ai nhận; 2 bên cùng tick = do tốn 30 giây đối chiếu ở mục 3.
5. OC báo "done" chỉ khi: test cũ pass + `node supabase/ci/verify-schema.mjs` pass (+ test mới nếu có).

## 4. Xung đột — phân loại & lộ trình

- **Kỹ thuật (tradeoff khác nhau)**: hai bên ghi tradeoff vào PR/spec → **PM quyết định**; chưa có quyết định thì theo spec đã duyệt.
- **Chính sách/ToS/rủi ro đạo đức**: HR ghi cảnh báo kèm dẫn chứng vào review → PM quyết. PM vẫn chọn đi tiếp → ghi "quyết định của PM, rủi ro đã cảnh báo" vào TASKS mục A rồi thực thi, không phá.
- **Git conflict (đụng text)**: file thuộc task nào → task đó merge trước, bên sau rebase. **Không force-push giữa 2 owner.**
- **Làm trùng**: đối chiếu checkbox TASKS.md — nguồn tranh chấp giải quyết ở bảng task, không giải quyết trong code.

## 5. Credential & an toàn (bài học P0-1)

- **Không bao giờ** commit `.env`, mật khẩu, TOTP secret, cookie/token vào repo — kể cả "test/demo".
- Fixture phải là giá trị giả rõ ràng (`00000000000000|matkhau|AAAA...|127.0.0.1:8080`).
- Pre-commit scan secret (gợi ý: `gitleaks detect` hoặc hook đơn giản bắt regex `uid|password|2FA` và base32 32 ký tự).
- Credential đã lọt → **luôn xoay (rotate)**, gỡ file không thu hồi được gì.
- Agent **không nhận mật khẩu/token qua chat**; PM tự đặt vào env ở máy chạy.

## 6. Ranh giới hệ thống (đã cảnh báo, PM quyết định giữ)

- Multi-account FB + comment tự động vi phạm Meta ToS → **chi phí account chết là chi phí vận hành**, PM đã được cảnh báo (REVIEW.md P0-1, §3.8).
- Dev tool (Playwright MCP, browser agent) **không dùng profile/proxy thật của farm** — chỉ profile sạch.
- HTTP surface: `WORKER_API_TOKEN` + Telegram secret + cron bearer — mọi route mới phải theo pattern constant-time compare có sẵn (`src/lib/cron/auth.ts`).
