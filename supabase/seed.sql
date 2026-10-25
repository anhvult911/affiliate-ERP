-- =============================================================================
-- Local development seed (runs automatically on `supabase db reset`).
--
-- Deterministic UUIDs so relationships are readable and re-running is stable.
-- After seeding, bootstrap your operator account (see README):
--   insert into public.operators (user_id, email)
--   values ('<auth.users.id>', '<email>') on conflict do nothing;
-- =============================================================================

-- 1. Social accounts — healthy, cooling down, checkpointed, and a second healthy
--    account so the 2-tier seeding task has two usable accounts.
insert into public.social_accounts
  (id, name, platform, persona_type, browser_profile_id, proxy_ip, status, trust_score,
   bio_link_url, persona_schedule, cooldown_until, notes, last_action_at)
values
  ('11111111-1111-4111-8111-111111111111', 'Mẹ Bỉm Ngọc', 'facebook', 'me_bim',
   'gpm-profile-101', '103.11.22.33:8000', 'active', 62, 'https://shope.ee/ngoc-deal',
   '[{"at":"09:30","kind":"lifestyle_post"},{"at":"20:00","kind":"cross_warm"}]'::jsonb,
   null, 'Nuôi từ tháng 3, tương tác tốt ở nhóm mẹ bỉm.', now() - interval '2 hours'),
  ('22222222-2222-4222-8222-222222222222', 'Trần Decor', 'facebook', 'decor',
   'gpm-profile-102', '103.11.22.34:8000', 'cooldown', 38, null,
   '[{"at":"12:00","kind":"lifestyle_post"}]'::jsonb,
   now() + interval '6 hours', 'Nghỉ sau 3 comment liên tiếp.', now() - interval '40 minutes'),
  ('33333333-3333-4333-8333-333333333333', 'Tech Review VN', 'facebook', 'tech',
   'genlogin-profile-77', '103.11.22.35:8000', 'checkpoint', 12, null,
   '[]'::jsonb, null, 'Chờ xác minh danh tính.', now() - interval '3 days'),
  ('44444444-4444-4444-8444-444444444444', 'Ngọc Nhà Cửa', 'facebook', 'decor',
   'gpm-profile-103', '103.11.22.36:8000', 'active', 44, null,
   '[{"at":"18:30","kind":"lifestyle_post"}]'::jsonb,
   null, 'Persona decor thứ hai, dùng cho seeding 2 tầng.', now() - interval '5 hours')
on conflict (id) do nothing;

-- 2. Radar watchlist.
insert into public.target_sources
  (id, name, url, source_type, niche, tone_of_voice, group_rules, scan_interval_mins,
   is_active, last_scanned_at)
values
  ('aaaa1111-1111-4111-8111-111111111111', 'Hội Mẹ Bỉm Sữa Săn Deal',
   'https://www.facebook.com/groups/me-bim-san-deal', 'group', 'me_bim',
   'Chị em, thân mật, hay dùng "mình" và "ạ"',
   'Không spam link trần, phải đăng kèm trải nghiệm.', 15, true, now() - interval '4 minutes'),
  ('aaaa2222-2222-4222-8222-222222222222', 'Nhà Đẹp Giá Rẻ',
   'https://www.facebook.com/groups/nha-dep-gia-re', 'group', 'decor',
   'Gọn, thực tế, tập trung vào giá và độ bền',
   'Cấm quảng cáo trực tiếp, chỉ được reply comment.', 30, true, now() - interval '12 minutes'),
  ('aaaa3333-3333-4333-8333-333333333333', 'KOL Review Đồ Gia Dụng',
   'https://www.facebook.com/kols/review-do-gia-dung', 'kol', 'gia_dung',
   'Trung lập, có số liệu', null, 60, true, now() - interval '25 minutes'),
  ('aaaa4444-4444-4444-8444-444444444444', 'Diễn đàn Tin Học Trẻ',
   'https://forum.tinhoc-tre.example.com', 'forum', 'tech',
   'Kỹ thuật, ngắn gọn', null, 120, false, null)
on conflict (id) do nothing;

-- 3. Product & affiliate pool. Embeddings are omitted here; the Python worker
--    backfills them via /api/worker/products/embed.
insert into public.products
  (id, shopee_item_id, name, price, commission_rate, affiliate_short_link,
   review_images, pros_cons_summary, niche, is_active)
values
  ('bbbb1111-1111-4111-8111-111111111111', '21458799831',
   'Máy hút sữa điện đôi cầm tay', 749000, 12.50, 'https://shope.ee/abc123',
   '["https://cf.shopee.vn/file/review-1.jpg","https://cf.shopee.vn/file/review-2.jpg"]'::jsonb,
   'Ưu: nhỏ, pin trâu, hút êm. Nhược: phễu hơi cứng với ngực lớn.', 'me_bim', true),
  ('bbbb2222-2222-4222-8222-222222222222', '21458799832',
   'Kệ nhựa đa năng 4 tầng', 289000, 18.00, 'https://shope.ee/def456',
   '["https://cf.shopee.vn/file/review-3.jpg"]'::jsonb,
   'Ưu: lắp 5 phút, chịu được 15kg. Nhược: nhựa mỏng ở chân kệ.', 'decor', true),
  ('bbbb3333-3333-4333-8333-333333333333', '21458799833',
   'Ghế lười văn phòng lưng cao', 1290000, 8.00, 'https://shope.ee/ghi789',
   '[]'::jsonb, 'Ưu: đỡ lưng tốt. Nhược: nặng, khó di chuyển.', 'decor', true),
  ('bbbb4444-4444-4444-8444-444444444444', '21458799834',
   'Sạc dự phòng 20.000mAh 22.5W', 359000, 6.50, 'https://shope.ee/jkl012',
   '["https://cf.shopee.vn/file/review-4.jpg"]'::jsonb,
   'Ưu: sạc nhanh, có display. Nhược: hơi nóng khi sạc 2 thiết bị.', 'tech', true),
  ('bbbb5555-5555-4555-8555-555555555555', '21458799835',
   'Máy xay sinh tố mini 400ml', 215000, 15.00, 'https://shope.ee/mno345',
   '[]'::jsonb, 'Ưu: rẻ, dễ vệ sinh. Nhược: ồn, không xay được đá.', 'gia_dung', true)
on conflict (id) do nothing;

-- 4. Radar output -> approval queue (one row per status so every UI state renders).
--    Completed/failed rows carry the execution timestamp the worker reports; the
--    schema enforces that a completed task has one.
insert into public.comment_tasks
  (id, source_id, post_url, post_content, post_images, match_score, matched_product_id,
   assigned_account_id, secondary_account_id, ai_draft_comment, selected_review_image,
   execution_mode, status, sub_id_code, executed_at, created_at)
values
  ('cccc1111-1111-4111-8111-111111111111', 'aaaa1111-1111-4111-8111-111111111111',
   'https://www.facebook.com/groups/me-bim-san-deal/posts/9001',
   'Có mẹ nào biết máy hút sữa nào hút êm mà pin lâu không ạ? Bé nhà mình bú ít nên phải hút nhiều lần.',
   '["https://scontent.fbcdn.net/v/post-9001-1.jpg"]'::jsonb, 0.927,
   'bbbb1111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', null,
   'Mình cũng hút nhiều lần trong ngày nên hiểu cảnh này. Mình đang dùng loại điện đôi cầm tay, hút êm và pin dùng được gần 2 ngày, đi làm vẫn mang theo được. Để mình gửi ảnh thực tế cho bạn tham khảo nhé.',
   'https://cf.shopee.vn/file/review-1.jpg', 'single', 'pending_approval',
   null, null, now() - interval '9 minutes'),
  ('cccc2222-2222-4222-8222-222222222222', 'aaaa2222-2222-4222-8222-222222222222',
   'https://www.facebook.com/groups/nha-dep-gia-re/posts/9002',
   'Phòng trọ 12m2 muốn kê thêm kệ để đồ mà không biết chọn loại nào cho gọn.',
   '[]'::jsonb, 0.884, 'bbbb2222-2222-4222-8222-222222222222',
   '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
   'Phòng 12m2 thì kệ 4 tầng là vừa đủ, lắp tầm 5 phút thôi. Nhà mình cũng dùng, để được khá nhiều đồ lặt vặt. Mình gửi ảnh cho bạn xem thử nhé!',
   'https://cf.shopee.vn/file/review-3.jpg', 'seeding_2_accounts', 'pending_approval',
   null, null, now() - interval '32 minutes'),
  ('cccc3333-3333-4333-8333-333333333333', 'aaaa3333-3333-4333-8333-333333333333',
   'https://www.facebook.com/kols/review-do-gia-dung/posts/9003',
   'Mình đang tìm sạc dự phòng 20.000mAh dùng cho chuyến đi 5 ngày, ưu tiên sạc nhanh.',
   '[]'::jsonb, 0.812, 'bbbb4444-4444-4444-8444-444444444444',
   '11111111-1111-4111-8111-111111111111', null,
   'Đi 5 ngày thì con 20.000mAh này dư dùng, có display báo % nên tiện. Mình để link trong phần bình luận nhé.',
   null, 'single', 'queued', 'T-9F2A11', null, now() - interval '55 minutes'),
  ('cccc4444-4444-4444-8444-444444444444', 'aaaa1111-1111-4111-8111-111111111111',
   'https://www.facebook.com/groups/me-bim-san-deal/posts/9004',
   'Bé nhà mình 6 tháng, đang tập ăn dặm, cần máy xay mini để xay cháo.',
   '[]'::jsonb, 0.861, 'bbbb5555-5555-4555-8555-555555555555',
   '11111111-1111-4111-8111-111111111111', null,
   'Mình xay cháo cho bé bằng máy mini 400ml, đủ một bữa nên không bị thừa. Rửa cũng nhanh.',
   null, 'single', 'completed', 'T-7B0C42', now() - interval '2 days', now() - interval '2 days'),
  ('cccc5555-5555-4555-8555-555555555555', 'aaaa2222-2222-4222-8222-222222222222',
   'https://www.facebook.com/groups/nha-dep-gia-re/posts/9005',
   'Có ai dùng ghế lười văn phòng chưa? Ngồi 8 tiếng có đau lưng không?',
   '[]'::jsonb, 0.805, 'bbbb3333-3333-4333-8333-333333333333',
   '22222222-2222-4222-8222-222222222222', null,
   'Ngồi 8 tiếng thì nên chọn lưng cao, mình đổi từ ghế thấp sang thấy đỡ hẳn.',
   null, 'single', 'failed', 'T-4D1E90', now() - interval '3 days', now() - interval '3 days'),
  ('cccc6666-6666-4666-8666-666666666666', 'aaaa3333-3333-4333-8333-333333333333',
   'https://www.facebook.com/kols/review-do-gia-dung/posts/9006',
   'Tổng hợp máy hút bụi cầm tay dưới 1 triệu, có ai gợi ý thêm không?',
   '[]'::jsonb, 0.645, null, null, null, null, null, 'single', 'rejected',
   null, null, now() - interval '4 days')
on conflict (id) do nothing;

update public.comment_tasks
   set last_error = 'Antidetect profile gpm-profile-102 returned checkpoint after submit.'
 where id = 'cccc5555-5555-4555-8555-555555555555';

-- 5. Conversions — one settled, one pending, one canceled.
insert into public.affiliate_conversions
  (id, task_id, sub_id, external_order_id, order_amount, estimated_commission, status,
   converted_at)
values
  ('dddd1111-1111-4111-8111-111111111111', 'cccc4444-4444-4444-8444-444444444444',
   'T-7B0C42', 'SP-20261018-0001', 215000, 32250, 'settled', now() - interval '1 day'),
  ('dddd2222-2222-4222-8222-222222222222', 'cccc3333-3333-4333-8333-333333333333',
   'T-9F2A11', 'SP-20261020-0002', 359000, 23335, 'pending', now() - interval '5 hours'),
  ('dddd3333-3333-4333-8333-333333333333', 'cccc5555-5555-4555-8555-555555555555',
   'T-4D1E90', 'SP-20261019-0003', 1290000, 103200, 'canceled', now() - interval '2 days')
on conflict (id) do nothing;
