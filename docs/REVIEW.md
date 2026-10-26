# Codebase Review — In-house Affiliate Automation & Social Hub

Phạm vi: đọc toàn bộ code thật (Next.js app, `workers/`, migrations, CI checks) và đối chiếu từng claim trong `MASTER_PROMPT.md` §6. Review này **chạy thử được thì chạy**: đã chạy `tests/` (27/27 pass) và `supabase/ci/verify-schema.mjs` (46/46 pass trên PGlite) trên chính máy review. Không sửa code; kết luận dựa trên `path:tường` bên dưới.

Cảnh báo độ chung chung: repo có đúng 1 commit (squash, `25985f0`), nên mọi phát hiện là trạng thái hiện tại, không suy đoán được lịch sử.

---

## 1. Điểm mạnh đã xác minh (code thật chứng minh, không phải claim)

1. **`unique (post_url)` + chuẩn hoá URL + xử lý race** — `supabase/migrations/20261020090000_init_schema.sql:228` đặt unique index; `src/lib/worker/url.ts:29-48` bóc tracking param (`mibextid`, `__cft__`, `utm_*`, `fbclid`…) trước khi check; ingest bắt lỗi `23505` và trả về `duplicate` thay vì 500 (`src/app/api/worker/radar/ingest/route.ts:258-263`). Claim §6 #6 **khớp** code.
2. **RLS theo operator allowlist, và RPC không lọt tới `anon`** — `public.is_operator()` là `security definer` với `search_path = ''` và bị revoke khỏi `public` (`init_schema.sql:286-299`); mọi bảng gắn policy `to authenticated using (is_operator())` (`init_schema.sql:310-327`); `claim_comment_tasks` bị revoke khỏi `anon`/`authenticated`, chỉ `service_role` dùng được (`init_schema.sql:537-538`). **Đã chạy** `verify-schema.mjs`: các check `anon cannot execute claim_comment_tasks`, `authenticated cannot execute the analytics RPCs`, `authenticated keeps is_operator()` đều PASS. Claim §6 #8 **khớp**.
3. **Daily limit có enforce thật, nhưng xem P1-2** — `daily_comment_limit`/`min_action_gap_minutes` được kiểm trong claim RPC (`supabase/migrations/20261024120000_account_daily_limits.sql:60-72`) và trong warming scheduler (`src/lib/warming/due.ts:132-138`, thêm giới hạn 1 hành động/vòng ở `due.ts:150-165, 219-220`). Check tự động của verifier PASS: `daily comment limit stops the claim`, `action gap blocks a second claim`. Claim §6 #11 **khớp một phần** (có lỗ hổng batch — xem findings).
4. **Claim atomic + lease tự hồi phục** — `FOR UPDATE SKIP LOCKED` + thu hồi task `running` quá 15 phút, tối đa 3 lần thử (`init_schema.sql:480-530`; `WORKER_LEASE_MINUTES = 15` ở `src/lib/constants.ts:40` khớp khoảng thời gian trong SQL — verifier PASS `claim resumes once the gap has passed`).
5. **Credential mã hoá at-rest, key tách khỏi DB** — AES-256-GCM, IV ngẫu nhiên mỗi giá trị, prefix version để xoay khoá (`src/lib/crypto/secret-box.ts:40-73`); import từ chối chạy nếu thiếu `ACCOUNT_CREDENTIALS_KEY` (`src/lib/actions/accounts.ts:328-330`); chỉ route worker bearer-token trả plaintext + TOTP sinh tại chỗ theo RFC 6238 (`src/app/api/worker/accounts/[id]/credentials/route.ts:60-84`; unit test vector RFC 6238 pass — đã chạy).
6. **Telegram webhook không mở toang** — thiếu `TELEGRAM_WEBHOOK_SECRET` thì route từ chối chạy hẳn (`src/app/api/telegram/webhook/route.ts:59-62`), so sánh secret constant-time bằng `timingSafeEqual` (`route.ts:166-172`). Claim §6 #2 về mặt cơ chế bảo mật **khớp**; caveat ở Open questions.
7. **Postback idempotent + trạng thái đơn điệu** — khoá theo `external_order_id` unique (`init_schema.sql:265`), merge thay vì upsert: `canceled` thắng mọi nơi, `settled` không hạ về `pending`, tiền chỉ tăng (`src/app/api/postback/shopee/route.ts:28-34, 73-110`); `converted_at` không bị replay đổi ngày (`route.ts:93`). Reconcile là RPC idempotent `security definer` chỉ gán `task_id` khi còn NULL (`supabase/migrations/20261024130000_reconcile_conversions.sql:24-38`) — verifier PASS 3 check reconcile.
8. **Report có kỷ luật** — chỉ task `running` do đúng worker claim mới nhận report (`src/app/api/worker/tasks/[id]/report/route.ts:58-69`); worker **không thể** self-lift checkpoint vì schema không nhận `active` (`route.ts:22`); trust chỉ +1 khi `completed` và không checkpoint (`route.ts:107-115`); ghi chú "comment chạy nhưng link reply hỏng" không bị giấu (`workers/src/index.ts:225-227`, `workers/src/execution/flow.ts:154-159`). Claim §6 #9 **khớp**.
9. **Test/verify thật, chạy được** — đã chạy: `npx tsx --test tests/*.test.ts` → **27/27 pass** (TOTP RFC 6238, schedule warming, parse CSV, format credential); `node supabase/ci/verify-schema.mjs` → **46/46 pass** trên PGlite, gồm claim/giới hạn/ngân sách/RLS/analytics tiền tệ (numerator ⊆ denominator, `init_schema.sql:610-635`). Lưu ý môi trường: `node_modules` không có sẵn, phải cài `zod`+`tsx` ad-hoc; pgvector bị skip có chủ đích (verifier tự in ra).
10. **An toàn mặc định hợp lý** — `DRY_RUN=true` là default (`workers/src/config.ts:128`); proxy được check reachable trước khi mở browser (`workers/src/index.ts:566-571`); profile lock chống 2 tiến trình mở cùng thư mục Chrome, tự giải sau 30 phút (`workers/src/providers/local.ts:52-91`); fixture-run được gắn `sandbox=true` và không ghi vào trạng thái tài khoản thật (`supabase/migrations/20261024110000_warming_sandbox.sql:8-12`, `workers/src/index.ts:529-531`).
11. **Embedding 768-dim nhất quán** — `vector(768)` (`init_schema.sql:177`) khớp `EMBEDDING_DIMENSIONS = 768` và guard ném lỗi khi model trả sai số chiều (`src/lib/ai/gemini.ts:234-256`). Claim §6 #1 **khớp** về mặt code (`.env.example` lệch — xem P2-2).
12. **`group_rules`/`tone_of_voice` được đưa vào prompt thật** — `src/lib/ai/prompts.ts:216-226` inject verbatim khi có giá trị. Claim §6 #10 **khớp**. `secondary_account_id` + check constraint (`init_schema.sql:229-231`) xác nhận claim §6 #5; `sub_id_code` unique (`init_schema.sql:212`) xác nhận một nửa claim §6 #7.

---

## 2. Findings xếp hạng

### P0 — làm ngay

**P0-1. Thông tin đăng nhập Facebook thật bị commit vào repo public (uid + mật khẩu + secret 2FA + thông tin proxy)**
- Dẫn chứng: `README.md:243-250` và `src/lib/accounts/credential-format.ts:7` chứa **cùng một dòng** theo định dạng `uid|password|2FA-secret|proxy` với uid 12 chữ số, mật khẩu dạng người thật, **secret TOTP base32 đầy đủ** và proxy `host:port:user:pass`; cùng uid/secret/proxy cũng xuất hiện làm placeholder ở `src/components/accounts/import-accounts-dialog.tsx:23-24`. Repo công khai, mọi thứ nằm ngay trong commit đầu (`25985f0`).
- Ảnh hưởng: ai đọc repo có đủ để chiếm FB account đó (secret 2FA + mật khẩu + proxy cùng subnet — bypass được phần lớn "đăng nhập đáng ngờ"), và biết được dàn proxy của farm. Nếu dòng này là export thật (đặc điểm giống export thật hơn placeholder), toàn bộ persona liên quan coi như mất. Vết này cũng là bằng chứng "quản lý nhiều tài khoản FB" cho bên thứ ba.
- Gợi ý: (1) **xoay vòng ngay** mật khẩu + 2FA + proxy của tài khoản trong dòng đó và của mọi tài khoản dùng chung proxy đó; (2) xoá dòng khỏi cả 3 file, thay bằng fixture rõ ràng là giả (`00000000000000|matkhau|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|127.0.0.1:8080`); (3) history đã public thì không gỡ được — coi như credential đã lộ, đổi là bắt buộc; (4) đưa check kiểu "secret TOTP/base32 + uid 10+ chữ số trong docs/src" vào pre-commit.

### P1 — rủi ro vận hành/tài khoản thật

**P1-1. `WORKER_API_TOKEN` được so sánh không constant-time — trái chuẩn mà chính repo tự đặt ra**
- Dẫn chứng: `src/lib/worker/auth.ts:27` — `if (token !== expected)`, trong khi cron dùng `safeEqual` có guard độ dài (`src/lib/cron/auth.ts:23-37`) và Telegram dùng `timingSafeEqual` (`src/app/api/telegram/webhook/route.ts:166-172`); chính comment của cron auth còn nói "Loops are tightened to the timing-safe comparison the Telegram webhook already uses" (`cron/auth.ts:8-9`) — worker auth bị bỏ sót.
- Ảnh hưởng: token này là **thứ duy nhất** che toàn bộ surface service-role: claim task, đọc credential giải mã của cả farm (`accounts/[id]/credentials`), ghi postback tiền tệ. Lộ prefix theo timing là một kênh tấn công brute-force rất chậm nhưng không nên có khi chi phí sửa bằng 0.
- Gợi ý: dùng lại pattern của `cron/auth.ts` (so đúng độ dài rồi XOR) hoặc `timingSafeEqual` của `node:crypto` cho `authorizeWorker`.

**P1-2. Ngân sách `daily_comment_limit` / `min_action_gap_minutes` có thể bị vượt ngay trong một lần claim**
- Dẫn chứng: `claim_comment_tasks()` đếm "completed trong 24h" và kiểm `last_action_at` trong **cùng một statement** với snapshot trước UPDATE (`supabase/migrations/20261024120000_account_daily_limits.sql:40-96`). Nếu một account đã chi 7/8 và có 5 task `queued`, cả 5 hàng đều thấy `count = 7 < 8` → cả 5 bị claim một lượt (limit mỗi lần claim tối đa 25 — `claim/route.ts:12`, `init_schema.sql:519`). Hai worker chạy song song cũng cùng nhìn một snapshot → cộng dồn thêm.
- Ảnh hưởng: đúng thứ mà comment migration cảnh báo là "the single fastest way to lose an account" (`account_daily_limits.sql:3-6`) lại bypass được bằng một batch. Tài khoản có thể post 7+25 comment thay vì 8. `min_action_gap_minutes` cũng tương tự: nhiều task claim chung một lúc sẽ chạy liên tiếp, bỏ qua gap.
- Gợi ý: trong CTE `picked` giới hạn tối đa 1 task mỗi `assigned_account_id` per call (dùng `distinct on` / window `row_number() partition by assigned_account_id`), hoặc cho claim chạy `limit = 1` lặp lại và đếm lại giữa các vòng; cộng thêm re-check sau UPDATE kiểu `where ... and (select count(*) ...) < limit` là không đủ vì cùng snapshot — cần tách statement hoặc dùng `pg_advisory_xact_lock` per account.

**P1-3. Radar Facebook: scrape DOM bằng selector, một tài khoản gánh hết lưu lượng quét, không có ngân sách quét**
- Dẫn chứng (câu hỏi bắt buộc): radar lấy data bằng cách **mở group/fanpage/KOL bằng chính browser profile của một tài khoản farm** rồi đọc DOM — `workers/src/index.ts:280-330` (chọn 1 account cao trust nhất qua `GET /api/worker/accounts/scan`, `src/app/api/worker/accounts/scan/route.ts:22-33`), `workers/src/radar/scanner.ts:77-93` (`page.goto` + scroll like human), trích xuất bằng selector gắn cứng: link bài viết `a[href*="/posts/"], a[href*="story_fbid"]…` và text `div[data-ad-comet-preview="message"], div[role="article"] div[dir="auto"]` (`workers/src/radar/targets.ts:34-45, 54-104`).
- Đánh giá độ bền: (i) **selector FB** — sửa DOM là mất hết, không có contract test cho selector thật, chỉ có fixture riêng (`targets.ts:107-159`); (ii) **login wall/checkpoint** chỉ bắt bằng heuristic URL (`/checkpoint`, `/login`…) + regex text EN/VI trên 6000 ký tự đầu (`workers/src/account-health.ts:17-55`) — wall mới (CAPTCHA canvas, challenge không có text quen thuộc) sẽ lọt và biến scroll thành spam; đã bắt được thì dừng nguyên vòng quét (`scanner.ts:124-130`) — đúng hướng, nhưng vẫn là **một tài khoản thật chịu rủi ro mỗi vòng quét**; (iii) **chỉ đọc phần viewport** sau 2-4 lần scroll, tối đa 12 post/nguồn (`scanner.ts:47, 98`) — group có "See more"/feed ảo danh sẽ mất bài; (iv) group private cần member thật, không có đường dự phòng (Graph API/cookie pool).
- Tập trung rủi ro: `scanAccounts` sắp theo `trust_score` giảm dần, scan **không** cập nhật `last_action_at` hay trust (`scan/route.ts:22-33`, không route nào ghi) → **cùng một account cao trust nhất quét mọi nguồn, mọi vòng, cả ngày** — chính tài khoản giá trị nhất nhận hết lưu lượng quét. Ngân sách ngày chỉ áp cho comment/warming (`account_daily_limits.sql`), không áp cho quét.
- Ảnh hưởng: một lần FB đổi DOM = radar mù hoàn toàn (dạng fail im lặng, chỉ biết khi queue hết capture); một account bị checkpoint = mất scanner.
- Gợi ý: (1) xoay vòng account quét (ghi `last_scanned_at`/`last_action_at` của account quét, sắp theo đó); (2) giới hạn số vòng quét/ngày cho mỗi account như một nhánh của `daily_warming_limit`; (3) alert khi N vòng liên tiếp 0 post (fail-loud cho selector chết); (4) cân nhắc tách "scanner profile" (1-2 acc chuyên đọc) khỏi dàn acc seeding để không phơi bày acc đang ủ.

**P1-4. Task `queued` không bao giờ hết hạn, và backlog cũ được thực thi trước**
- Dẫn chứng: claim sắp theo `approved_at asc nulls last` (`init_schema.sql:518`, `account_daily_limits.sql:85`) và **không có bất kỳ ràng buộc độ tuổi nào** trên `post_url`/`created_at`/`approved_at`. Không cron nào sweep task queued quá hạn (`/api/cron/health` chỉ đếm, `src/app/api/cron/health/route.ts:51-62`).
- Ảnh hưởng: một bài viết đã 3 tuần tuổi, khi budget freeing lên, sẽ được comment/link affiliate vào — vừa không ra đơn, vừa là tín hiệu spam kinh điển (comment trôi nổi trên bài cũ), tăng xác suất checkpoint. `sub_id` vẫn mint bình thường nên còn làm lệch cả analytics "tuổi tác" conversion.
- Gợi ý: giới hạn tuổi tối đa khi approve/claim (ví dụ bỏ qua và đánh dấu `failed` với `last_error = "stale post"` nếu `created_at` > N ngày — nên N = 7 với niche deal); thêm tuổi bài post vào payload claim để UI hiện cảnh báo trước khi duyệt.

**P1-5. Task chết giữa chừng sau 3 lần thử kẹt vĩnh viễn ở trạng thái `running`**
- Dẫn chứng: điều kiện thu hồi lease là `attempt_count < 3` (`init_schema.sql:492-495`); nếu worker chết (kill -9, VPS reboot) đủ 3 lần giữa claim và report, task ở `running` + `attempt_count = 3` **không còn nhánh nào tự sửa**: claim bỏ qua, cron health chỉ đếm vào `backlog` (`cron/health/route.ts:51-62`) rồi alert chung chung "worker stale" nếu có backlog. May mắn là thao tác thủ công còn đường thoát: `returnTaskToApproval` kéo được running quá lease về `pending_approval` bất kể attempt count (`src/lib/actions/comment-tasks.ts:255-283`).
- Ảnh hưởng: queuetreo "Đang chạy" mãi, dashboard hiển thị sai backlog thực, và nếu lặp lại nhiều lần thì operator phải tự nhớ quy tắc 15 phút/3 lần.
- Gợi ý: một nhánh trong `/api/cron/health` (hoặc cron riêng) chuyển `running` quá lease + `attempt_count >= 3` sang `failed` với `last_error = "lease exhausted"`; gửi Telegram alert kèm task id. Tách luôn "worker stale" khỏi "task stuck" vì hai thứ khác nhau.

### P2 — nên sửa, chi phí thấp

**P2-1. Claim "worker từ chối post thật với `ANTIDETECT_PROVIDER=local`" không tồn tại trong code**
- Dẫn chứng: `README.md:375-377` ("the worker refuses to post for real with `ANTIDETECT_PROVIDER=local`") và docstring `workers/src/config.ts:4-7` ("the worker refuses to run outside dry-run unless a real antidetect provider is configured") — nhưng `loadConfig()` (`config.ts:118-161`) **không có check nào** ghép `provider === "local"` với `dryRun`; `main()` cũng không (`workers/src/index.ts:42-136`). `DRY_RUN=false EXECUTOR=facebook ANTIDETECT_PROVIDER=local` sẽ post thật. (Mâu thuẫn một phần với claim §6 #4 — nơi nói local là default để đăng nhập thật; có thể hành vi post thật là chủ đích, nhưng guard trong docs thì bịa.)
- Ảnh hưởng: operator tin vào guard không có thật; sai spec-vs-code nghiêm trọng vì đây là điểm an toàn duy nhất còn lại của luồng post.
- Gợi ý: hoặc code hoá guard thật (từ chối `dryRun=false && provider=local` trừ khi có env `ALLOW_LOCAL_POSTING=true`), hoặc sửa docs mô tả đúng: `DRY_RUN` là guard duy nhất, local vẫn post được.

**P2-2. `.env.example` trỏ vào model đã nghỉ hưu — copy-paste là radar tự suy giảm**
- Dẫn chứng: `.env.example:13` (`GEMINI_MODEL="gemini-2.5-flash"`) và `.env.example:15` (`GEMINI_EMBEDDING_MODEL="text-embedding-004"`) — trong khi code nói rõ `gemini-2.5-flash` từ chối key mới (`src/lib/ai/gemini.ts:29-33`, default `gemini-3.1-flash-lite`) và `text-embedding-004` đã retire, default là `gemini-embedding-001` (`gemini.ts:42-45`); `README.md:45` cũng xác nhận hai model kia "are retired for new keys".
- Ảnh hưởng: ai dựng theo `.env.example` (README bảo "copy .env.example", `README.md:34`) sẽ có match/draft fail; embedding fail thì ingest lén rơi về lọc theo niche (`ingest/route.ts:139-152`) — radar vẫn chạy nhưng match kém đi mà không báo lỗi ra UI.
- Gợi ý: đồng bộ `.env.example` với default trong `gemini.ts` (bỏ hai dòng model khỏi example, chỉ comment hướng dẫn override).

**P2-3. Telegram webhook không giới hạn chat_id**
- Dẫn chứng: `POST` chỉ kiểm secret header rồi xử lý update từ **bất kỳ chat nào** (`src/app/api/telegram/webhook/route.ts:58-85`); `handleCommand` trả lời `/queue`, `/status` bất kể ai gửi (`route.ts:87-117`). Tin nhắn được gửi về `TELEGRAM_CHAT_ID` cố định (`src/lib/telegram/api.ts:69-71`) nên **không lộ dữ liệu cho kẻ gửi**, và callback approve/reject chỉ sinh từ nút bot gửi đi (nên không giả mạo được duyệt bài).
- Ảnh hưởng: bất kỳ ai biết tên bot cũng spam `/queue` được → hàng chục digest + nút bấm bắn vào chat của operator (DoS phiền toái, và trong đó có nút ✅ bấm nhầm là duyệt thật). Thiếu defence-in-depth cho surface quản trị.
- Gợi ý: từ chối update có `chat.id !== TELEGRAM_CHAT_ID` (với callback: kiểm `query.message.chat.id`), log lại số update bị bỏ.

**P2-4. Post dưới ngưỡng match bị quét lại vĩnh viễn → đốt quota Gemini**
- Dẫn chứng: ingest chỉ ghi `last_scanned_at` khi below threshold, **không lưu dấu vết bài đã xét** (`src/app/api/worker/radar/ingest/route.ts:175-189`); dedupe chỉ check `comment_tasks.post_url` (`route.ts:67-75`) — bài không được tạo task thì lần quét sau lại embed + re-rank. Nhóm đông, 12 bài đầu gần như đứng yên → mỗi `scan_interval_mins` (mặc định 15 phút, `init_schema.sql:146`) lại gọi 1 embed + 1 match cho mỗi bài cũ.
- Ảnh hưởng: chi phí/quota Gemini tăng theo bề rộng nhóm, độ trễ ingest tăng, và bảng không có nơi tra "bài này từng score bao nhiêu" để tuning ngưỡng.
- Gợi ý: bảng `radar_seen(post_url unique, source_id, score, seen_at)` (hoặc cột trên `target_sources` dạng jsonb TTL) để skip + hiện lịch sử score trên UI.

**P2-5. Chạy `DRY_RUN=true` với queue thật làm "đốt" task thật**
- Dẫn chứng: dry-run vẫn claim task thật rồi report `failed` với `last_error = "Dry run: nothing was posted."` (`workers/src/index.ts:215-217`), qua route report nó set `status=failed`, `executed_at`, `last_error` và **gửi Telegram alert** (`report/route.ts:71-77, 155-157`); `attempt_count` đã +1 từ lúc claim.
- Ảnh hưởng: thử nghiệm dry-run trên DB dùng thật làm ô queue (task rơi vào `failed`, operator phải duyệt lại tay, alert spam). Fixture/sandbox có cờ `sandbox` cho warming nhưng **không có tương đương cho comment task**.
- Gợi ý: khi `dryRun`, worker dùng fixture executor hoặc claim với worker-name riêng và report status đặc biệt; ít nhất: bỏ qua claim khi `EXECUTOR=fixture` + `DRY_RUN=true` trừ khi có env `DRY_RUN_CLAIMS=true`.

**P2-6. `trust_score` nâng bằng read-modify-write — mất cập nhật khi chạy song song**
- Dẫn chứng: `report/route.ts:107-115` và `:135-147` đọc `trust_score` rồi ghi lại `min(100, x+1)` — hai report đồng thời (hai worker, primary + secondary) có thể ghi đè nhau.
- Ảnh hưởng: trust tăng chậm hơn thực tế; không nghiêm trọng nhưng là dữ liệu điều phối account.
- Gợi ý: `update ... set trust_score = least(100, trust_score + 1)` một statement (RPC hoặc expression trong supabase-js không được thì dùng trigger).

**P2-7. Report tin tưởng `executedAt` do worker gửi**
- Dẫn chứng: `reportSchema` nhận `executedAt` tuỳ ý (`report/route.ts:14`) và ghi thẳng (`route.ts:75`).
- Ảnh hưởng: đồng hồ worker lệch (VPS khác timezone/NTP chết) sẽ backdate `executed_at` → lệch cửa sổ rolling-24h của `daily_comment_limit` và series analytics theo ngày (`init_schema.sql:638-674` group theo `converted_at`, nhưng `executed_at` nuôi KPI khác).
- Gợi ý: server tự set thời điểm nhận report; chỉ cho phép client gửi delta tối đa ±2 phút để debug.

**P2-8. Lệch tài liệu (không phải code sai, nhưng làm mất niềm tin vào spec)**
- Dẫn chứng: `README.md:382` nói verifier có "26 assertions" — thực tế chạy ra **46/46**; `MASTER_PROMPT.md:26` vẫn liệt kê `gemini-1.5-flash` và "Python (FastAPI + Playwright) **or** Node.js (BullMQ)" trong khi đã build bằng `@google/genai` + Node/Playwright thật (`workers/package.json:16-18`, `package.json:25`); `MASTER_PROMPT.md:187` claim Telegram "Verified end to end against a real bot" trong khi phần verify mà repo ghi lại là qua stub `TELEGRAM_API_BASE` (`README.md:234-239`) — verify bằng stub là tốt, nhưng hai claim không cùng một mức.
- Ảnh hưởng: người đọc (hoặc agent build tiếp) không biết tin đâu; §6 được dùng như source of truth nên mismatch phải cập nhật.
- Gợi ý: sửa số assertion trong README, cập nhật §2/§6 thành trạng thái đã build, ghi rõ mức verify thực tế của từng module.

Ghi chú phụ (chỉ ghi nhận, không xếp hạng): `generateSubIdCode` dùng alphabet 33 ký tự lấy `% byte` (`src/lib/actions/comment-tasks.ts:20-27`) — có slight modulo bias, không đáng lo về không gian khoá nhưng nên đổi sang `% 32` hoặc rejection sampling nếu đụng tới tần suất cao; heartbeat mỗi 60s (`config.ts:145`) = ~1.440 invocation/ngày vào route Vercel — xem Open questions về chi phí.

---

## 3. Open questions cho PM

1. **Dòng `uid|pass|2FA|proxy` trong README/credential-format có phải dữ liệu thật không?** Nếu có: tài khoản đó còn dùng không, đã xoay mật khẩu/2FA/proxy chưa (P0-1)? Có bao nhiêu account dùng chung proxy trong dòng đó?
2. **Chạy mấy worker và ở đâu?** Nếu chỉ 1 worker VPS thì P1-2 nhẹ hơn (vẫn vượt limit theo batch); nếu định thêm worker thứ hai hoặc tách process warming/radar, phải sửa claim trước.
3. **Chính sách task cũ**: chấp nhận comment vào bài bao nhiêu ngày tuổi? (P1-4 — đề xuất 7 ngày.)
4. **Ngân sách Gemini**: mức quota/tháng hiện tại là bao nhiêu, có chấp nhận quét lại bài dưới ngưỡng mỗi 15 phút (P2-4) không, hay muốn negative cache ngay?
5. **`ANTIDETECT_PROVIDER=local` post thật có phải chủ đích không?** (P2-1 — docs nói không, code cho phép.) Nếu chủ đích, khi nào nâng lên GPM/Genlogin khi số persona tăng (claim §6 #4 nói "khi nhiều persona chạy từ một máy")?
6. **Vercel plan**: `vercel.json` khai 2 cron (`vercel.json:3-6`) + ~1.440 heartbeat invocation/ngày — gói hiện tại có gánh không, hay chuyển health/reconcile sang cron-job.org/VPS timer (code đã hỗ trợ cả GET và bearer fallback, `src/lib/cron/auth.ts:11`)?
7. **Xác nhận mức verify Telegram**: claim §6 #2 "verified against a real bot" — đã chạy thật với bot thật chưa, và secret có đủ mạnh/đã rotate sau khi repo public?
8. **Chấp nhận rủi ro ToS** (mục 2, phần compliance): multi-account + comment tự động là vi phạm rõ điều khoản Meta; số tài khoản tối đa bạn sẵns sàng mất trong một đợt quét/đợt comment là bao nhiêu? (Điều này quyết định mức `daily_comment_limit` 8/ngày hiện tại — vốn vẫn là mức "automation", không phải mức "con người".)

---

## 4. Đề xuất bước tiếp theo (theo thứ tự ưu tiên)

1. **Xoay credential + gỡ dòng thật khỏi 3 file** (P0-1) — không đụng code, làm ngay hôm nay.
2. **Sửa `authorizeWorker` sang so sánh constant-time** (P1-1) — 5 dòng.
3. **Sửa claim để mỗi lần claim tối đa 1 task/account, và thêm re-check gap** (P1-2) — sửa SQL + chạy lại `verify-schema.mjs`, thêm test case "một claim chỉ lấy 1 task cho mỗi account".
4. **Cron dọn `running` kẹt + task queued quá hạn** (P1-5, P1-4) — một route cron mới hoặc mở rộng `/api/cron/health`.
5. **Radar: xoay vòng account quét + alert 0-post liên tiếp + giới hạn vòng quét/ngày** (P1-3) — giảm tập trung rủi ro lên một account.
6. **Dọn doc/claim sai**: `.env.example` model (P2-2), guard local-posting (P2-1), số assertion README (P2-8), cập nhật `MASTER_PROMPT.md` §2/§6 về trạng thái thật.
7. **Telegram chat allowlist (P2-3) và negative cache cho radar (P2-4)** — hai thay đổi nhỏ, lợi ích vận hành rõ.
8. **Tự động hoá kiểm regression**: thêm test cho ingest/postback/webhook (hiện unit test chỉ phủ lib thuần, phần route được verify thủ công — nên đưa assertion của `rls_check.sql` + postback merge vào `verify-schema.mjs` cho trọn vòng lặp).

---

*Repo state reviewed: main@25985f0 + working tree*
