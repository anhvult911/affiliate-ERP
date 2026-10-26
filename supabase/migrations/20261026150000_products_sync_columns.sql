-- Products: fields the Shopee offer sync needs, plus the uniqueness the upsert relies on.
--
-- docs/SHOPEE_API.md §5.1/§5.3 (T-SHOPEE-05). `productOfferV2` returns an offer link and
-- a plain product link; the short-link mutation later needs the plain one as
-- `originUrl`, so it has to be stored. The remaining columns are offer metadata that
-- the sync writes and the UI can show later — all optional, so CSV imports keep
-- working untouched.
--
-- `affiliate_short_link` had no unique constraint, which made "upsert by offer link"
-- impossible: two sync runs could insert the same product twice. Verified no
-- duplicates exist before adding it.
--
-- Rollback: drop the unique index, then the columns added below. Nothing depends on
-- them yet (T-SHOPEE-04 lands after Shopee access is granted).

alter table public.products
  add column if not exists origin_link text,
  add column if not exists shop_id text,
  add column if not exists shop_name text,
  add column if not exists image_url text,
  add column if not exists sales int,
  add column if not exists rating_star numeric(3, 2),
  add column if not exists seller_commission_rate numeric(5, 2),
  add column if not exists shopee_commission_rate numeric(5, 2),
  add column if not exists offer_period_end_at timestamptz,
  add column if not exists sync_source text not null default 'csv',
  add column if not exists last_synced_at timestamptz;

alter table public.products
  drop constraint if exists products_sync_source_check,
  drop constraint if exists products_rating_star_check,
  drop constraint if exists products_sales_check;

alter table public.products
  add constraint products_sync_source_check check (sync_source in ('csv', 'api')),
  add constraint products_rating_star_check check (rating_star is null or rating_star between 0 and 5),
  add constraint products_sales_check check (sales is null or sales >= 0);

-- One product per offer link: this is what makes the sync idempotent.
create unique index if not exists products_affiliate_short_link_key
  on public.products (affiliate_short_link);

comment on column public.products.origin_link is
  'Plain Shopee product URL — the originUrl for generateShortLink (API-synced rows only).';
comment on column public.products.sync_source is
  'csv = imported by the operator, api = written by the Shopee offer sync.';
