-- =============================================================================
-- Facebook Group Radar — Phase 1: Lead Hunter & Mini CRM
--
-- Extends the existing radar instead of adding a second data path:
--   * target_sources becomes the watchlist (`user_id`, `keywords_json`)
--   * leads stores every post the intent classifier judged, plus the CRM state
--     the 48h follow-up job needs
--
-- Ownership: every row carries `user_id text default 'default_owner'`. Phase 1
-- has exactly one authenticated operator (`public.is_operator()`), so RLS is
-- "operator AND owner" rather than a real tenant join. The owner constant lives
-- in public.lead_owner_id() so Phase 2 changes one function, not every policy.
--
-- Rollback: drop the triggers/functions, drop table public.leads, drop the two
-- target_sources columns and the three enum types, and restore the previous
-- target_sources RLS policy ("operators full access" using is_operator()).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enumerated classification / CRM values (contract with src/lib/leads/config.ts
-- and the classifier JSON schema).
-- -----------------------------------------------------------------------------
create type public.lead_intent as enum (
  'buyer_inquiry',
  'help_needed',
  'seller_promo',
  'irrelevant'
);

create type public.lead_category as enum ('sheets_excel', 'automation', 'other');

-- `pending_review` = raw post persisted before/without a successful LLM call.
-- Classified posts start at `new` (the column default). Terminal states clear
-- the follow-up clock; see apply_lead_status_rules() below.
create type public.lead_status as enum (
  'pending_review',
  'new',
  'replied',
  'sent_freebie',
  'bought_template',
  'upsold_automation',
  'ignored'
);

-- -----------------------------------------------------------------------------
-- Ownership + default keyword preset
-- -----------------------------------------------------------------------------
-- Single source of truth for the Phase 1 tenant. Phase 2 replaces the body with
-- a lookup from auth.uid() to the tenant id; RLS policies keep working.
create or replace function public.lead_owner_id()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'default_owner'::text;
$$;

revoke all on function public.lead_owner_id() from public;
grant execute on function public.lead_owner_id() to authenticated;

-- Vietnamese high-intent seed set from the product spec. Kept as a function so
-- both the column default and the "new group" path use one list, and so the
-- verify harness can compare against it by name.
create or replace function public.default_lead_keywords()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[
    "file excel","google sheet","tính lãi lỗ","phí sàn","đối soát",
    "quản lý kho","công nợ","báo cáo doanh thu","file quản lý","quản lý dòng tiền",
    "tự động","gửi về zalo","báo đơn telegram","apps script","n8n",
    "make.com","gom đơn","đồng bộ đơn","thuê làm tool","cần người code","cào dữ liệu"
  ]'::jsonb;
$$;

revoke all on function public.default_lead_keywords() from public;
grant execute on function public.default_lead_keywords() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Watchlist: extend target_sources in place (existing rows / urls preserved)
-- -----------------------------------------------------------------------------
alter table public.target_sources
  add column if not exists user_id text not null default 'default_owner',
  add column if not exists keywords_json jsonb not null default public.default_lead_keywords();

alter table public.target_sources
  drop constraint if exists target_sources_keywords_array_check;
alter table public.target_sources
  add constraint target_sources_keywords_array_check
  check (
    jsonb_typeof(keywords_json) = 'array'
    -- SQL/JSON path: reject numeric/object elements, not just a non-array root.
    and not jsonb_path_exists(keywords_json, '$[*] ? (@.type() != "string")')
  );

-- Phase 1 still behaves like one URL per watchlist because every row is
-- default_owner. Keying the constraint on (user_id, url) instead of url alone
-- lets two Phase 2 owners track the same group without cloning the URL.
alter table public.target_sources
  drop constraint if exists target_sources_url_key;
alter table public.target_sources
  drop constraint if exists target_sources_user_url_key;
alter table public.target_sources
  add constraint target_sources_user_url_key unique (user_id, url);

-- Composite FK target for leads: a lead may only point at a group owned by the
-- same user. Redundant with the primary key, but the FK needs the pair.
alter table public.target_sources
  drop constraint if exists target_sources_id_user_id_key;
alter table public.target_sources
  add constraint target_sources_id_user_id_key unique (id, user_id);

create index if not exists target_sources_owner_active_idx
  on public.target_sources (user_id, is_active, last_scanned_at nulls first);

comment on column public.target_sources.user_id is
  'Phase 1 tenant key; always public.lead_owner_id() until Phase 2 auth lands.';
comment on column public.target_sources.keywords_json is
  'Array of Vietnamese intent keywords scanned for this group/post source.';

-- -----------------------------------------------------------------------------
-- Leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default_owner',
  post_id text not null check (length(trim(post_id)) > 0),
  -- Nullable: a lead can come from a group that is not (or no longer) on the
  -- watchlist. group_name is denormalised so the row still reads correctly.
  group_id uuid,
  group_name text not null check (length(trim(group_name)) > 0),
  post_url text not null check (post_url ~* '^https?://'),
  author_name text,
  post_content text not null check (length(trim(post_content)) > 0),
  -- Null while `status = 'pending_review'` (raw post saved, LLM failed/absent).
  intent_type public.lead_intent,
  score int check (score between 1 and 5),
  matched_category public.lead_category,
  summary text,
  suggested_comment text,
  suggested_dm text,
  status public.lead_status not null default 'new',
  notes text,
  alert_sent_at timestamptz,
  last_contacted_at timestamptz,
  next_followup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Dedupe key: the radar may see the same post on every scan; the pipeline
  -- claims it with `insert ... on conflict (user_id, post_id) do nothing`.
  constraint leads_user_post_key unique (user_id, post_id),
  -- Same-owner group: (group_id, user_id) must exist in target_sources. On
  -- delete only group_id is nulled (PG15+ column list); user_id is NOT NULL and
  -- the lead itself must survive the group leaving the watchlist.
  constraint leads_group_owner_fkey
    foreign key (group_id, user_id)
    references public.target_sources (id, user_id)
    on delete set null (group_id),
  -- Raw rows have no intent and no score; a classified row has both.
  constraint leads_intent_score_pair_check check ((intent_type is null) = (score is null))
);

create index if not exists leads_owner_created_idx
  on public.leads (user_id, created_at desc);
create index if not exists leads_owner_status_created_idx
  on public.leads (user_id, status, created_at desc);
create index if not exists leads_owner_score_idx
  on public.leads (user_id, score desc nulls last);
create index if not exists leads_owner_category_idx
  on public.leads (user_id, matched_category)
  where matched_category is not null;
create index if not exists leads_group_id_idx
  on public.leads (group_id)
  where group_id is not null;
-- The 09:00 reminder job: status IN (replied, sent_freebie) AND next_followup_at <= now().
create index if not exists leads_followup_due_idx
  on public.leads (user_id, next_followup_at)
  where status in ('replied', 'sent_freebie') and next_followup_at is not null;

-- -----------------------------------------------------------------------------
-- CRM timestamps
--
-- Contract:
--   * entering replied / sent_freebie  -> last_contacted_at = now(),
--                                         next_followup_at = now() + 48h unless
--                                         the UPDATE supplies its own value
--                                         (manual override wins when it differs
--                                         from the stored one)
--   * entering bought_template / upsold_automation / ignored -> next_followup_at = null
--   * any other edit (notes, score, ...) -> timestamps untouched
-- -----------------------------------------------------------------------------
create or replace function public.apply_lead_status_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('replied', 'sent_freebie') then
      new.last_contacted_at := coalesce(new.last_contacted_at, now());
      new.next_followup_at := coalesce(new.next_followup_at, now() + interval '48 hours');
    elsif new.status in ('bought_template', 'upsold_automation', 'ignored') then
      new.next_followup_at := null;
    end if;
    return new;
  end if;

  -- Same status: an ordinary field edit must not restart the follow-up clock.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('replied', 'sent_freebie') then
    new.last_contacted_at := now();
    -- A different value than the stored one is an explicit override; an
    -- untouched column comes back equal and receives the +48h default.
    if new.next_followup_at is not distinct from old.next_followup_at then
      new.next_followup_at := now() + interval '48 hours';
    end if;
  elsif new.status in ('bought_template', 'upsold_automation', 'ignored') then
    new.next_followup_at := null;
  end if;

  return new;
end;
$$;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger leads_apply_status_rules
  before insert or update on public.leads
  for each row execute function public.apply_lead_status_rules();

-- -----------------------------------------------------------------------------
-- RLS: existing operator auth + Phase 1 owner scope
-- -----------------------------------------------------------------------------
alter table public.leads enable row level security;

drop policy if exists "operators manage own leads" on public.leads;
create policy "operators manage own leads"
  on public.leads
  for all to authenticated
  using (public.is_operator() and user_id = public.lead_owner_id())
  with check (public.is_operator() and user_id = public.lead_owner_id());

-- The watchlist had an operator-only policy with no tenant filter. Replace it:
-- same auth, plus the owner column every Phase 2 query will rely on. Existing
-- rows were backfilled to 'default_owner', so current dashboards are unaffected.
drop policy if exists "operators full access" on public.target_sources;
drop policy if exists "operators manage own target sources" on public.target_sources;
create policy "operators manage own target sources"
  on public.target_sources
  for all to authenticated
  using (public.is_operator() and user_id = public.lead_owner_id())
  with check (public.is_operator() and user_id = public.lead_owner_id());

-- -----------------------------------------------------------------------------
-- Visibility for Supabase's schema linter / PostgREST
-- -----------------------------------------------------------------------------
comment on table public.leads is
  'Phase 1 lead hunter: classified radar posts plus mini-CRM state (48h follow-up).';
comment on column public.leads.score is
  'LLM intent score 1-5; null only for pending_review raw rows.';
comment on column public.leads.next_followup_at is
  'Set to +48h when a lead enters replied/sent_freebie, cleared on terminal states.';
