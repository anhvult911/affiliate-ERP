-- Deal channel posting (P5-1).
--
-- The deal poster picks a product, writes a post and sends it to the Telegram channel.
-- Three columns keep that idempotent without a separate jobs table:
--
--   last_dealt_at       when the product was last posted to the channel (7-day cooldown)
--   deal_previewed_at   when the draft was last sent to the operator for approval, so the
--                       two daily cron ticks do not preview the same product twice
--   deal_caption        the exact text the operator approved, so "Đăng" posts what was
--                       reviewed instead of regenerating a different draft
--
-- Rollback: drop the index, then the three columns. Nothing references them.

alter table public.products
  add column if not exists last_dealt_at timestamptz,
  add column if not exists deal_previewed_at timestamptz,
  add column if not exists deal_caption text;

-- The selection orders by commission rate among active, link-bearing products. A partial
-- index keeps that scan small as the catalog grows; the cooldown is applied in the query.
create index if not exists products_deal_candidates_idx
  on public.products (commission_rate desc nulls last)
  where is_active and affiliate_short_link is not null;

comment on column public.products.last_dealt_at is
  'Last time this product was posted to the deal channel; the poster skips it for 7 days.';
comment on column public.products.deal_previewed_at is
  'Last time a deal draft for this product was sent to the operator (preview mode).';
comment on column public.products.deal_caption is
  'The exact caption approved in preview mode; posted verbatim so review matches output.';
