# AGENTS.md — Điểm vào cho mọi coding agent trong repo này

Bạn là agent (OpenCode / Hermes / khác) mới mở repo này. Đọc theo thứ tự:

1. **`README.md`** — stack, modules, cách dựng local.
2. **`MASTER_PROMPT.md`** — spec gốc & các quyết định đã chốt (§6 = lịch sử gap đã resolve).
3. **`docs/TASKS.md`** — **bảng việc duy nhất**. Task nào nhận thì tick checkbox. Không tick = chưa ai nhận.
4. **`docs/COLLAB.md`** — phân vai, luật conflict, luật credential. **Bắt buộc đọc trước khi commit đầu tiên.**
5. Khi làm task liên quan:
   - Sửa lỗi trong REVIEW → đọc `docs/REVIEW.md` (dẫn chứng `file:line`, có AC gợi ý)
   - Tích hợp Shopee → đọc `docs/SHOPEE_API.md` (14 task `T-SHOPEE-*` kèm acceptance criteria)

## 5 luật cứng

1. **Không commit secret** — `.env`, mật khẩu, TOTP, token. Fixture phải là giá trị giả rõ ràng. (Bài học P0-1: một dòng credential thật đã lọt vào README khi repo public.)
2. **Không sửa `docs/`** — của agent review. Phản hồi → issue/PR comment.
3. **1 task = 1 nhánh = 1 owner**; commit đầu có ID task (`P1-2: ...`).
4. **Không code theo phỏng đoán khi có open question** — 8 câu hỏi trong `docs/REVIEW.md` §3 là của PM. Không trả lời thay.
5. **"Xong" = test pass** — `npx tsx --test tests/*.test.ts` + `node supabase/ci/verify-schema.mjs`, và mô tả changed files + test mới trong PR.

## Trạng thái hiện tại

- Review đầy đủ: `docs/REVIEW.md` — 1 P0 / 5 P1 / 8 P2 trên `main@25985f0`.
- Shopee API: `docs/SHOPEE_API.md` — endpoint VN đã probe, `T-SHOPEE-01..14`; 04–08, 11 **chờ credential** (PM xin App ID/Secret).
- Bảng việc gộp: `docs/TASKS.md`.
