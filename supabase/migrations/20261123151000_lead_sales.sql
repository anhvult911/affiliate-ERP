-- =============================================================================
-- Lead sales: explicit milestones, actual receipts, and the 14-day group funnel
--
-- Design contract:
--   * A milestone exists only when an operator explicitly records it. Missing
--     rows are "not reached" — nothing is inferred from `leads.status`.
--   * Every milestone carries the operator-supplied historical timestamp, so a
--     backfilled conversation still lands in its real day, not today.
--   * Receipts are actual cash (VND) with a payment date, type and an
--     idempotency key. Repeat payments are allowed and each one counts; a
--     retried submission carrying the same key never does.
--   * `lead_recurring_terms` stores an agreed monthly maintenance rate. It is
--     reported separately from cash and is explicitly NOT MRR: no receipt is
--     multiplied, projected or annualised.
--   * The funnel view counts distinct leads per explicit event inside the
--     current Vietnam-calendar 14-day window, capped at now(). It deliberately
--     reports event counts rather than cross-window ratios (a lead qualified
--     before the window can still hold a conversation inside it). The only
--     division left is average cash per paid customer, guarded by nullif.
--
-- Ownership mirrors 20261123120000_leads_crm.sql: operator auth + tenant key
-- from public.lead_owner_id(). Group attribution is snapshotted on insert from
-- the lead, so a payment still belongs to the group it was collected in even if
-- the lead/group later changes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Vocabulary (mirrors src/lib/leads/sales.ts)
-- -----------------------------------------------------------------------------
create type public.lead_milestone_kind as enum (
  'qualified',
  'two_way_conversation',
  'trial_use_confirmed'
);

create type public.lead_receipt_kind as enum (
  'template',
  'setup',
  'maintenance'
);

-- -----------------------------------------------------------------------------
-- Composite FK targets
-- -----------------------------------------------------------------------------
-- `id` is already unique; the pair is what lets (lead_id, user_id) foreign keys
-- enforce that a sales row and its lead belong to the same owner.
alter table public.leads
  add constraint leads_id_user_id_key unique (id, user_id);

-- -----------------------------------------------------------------------------
-- Explicit milestones
--
-- `group_name` carries an empty default only so PostgREST inserts may omit a
-- column the BEFORE trigger always fills from the lead; the check constraint
-- rejects the row if that trigger ever failed to do so.
-- -----------------------------------------------------------------------------
create table public.lead_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.lead_owner_id(),
  lead_id uuid not null,
  group_id uuid,
  group_name text not null default '' check (length(trim(group_name)) > 0),
  kind public.lead_milestone_kind not null,
  occurred_at timestamptz not null,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per milestone per lead: re-marking updates the timestamp instead
  -- of creating a second event that would inflate the funnel.
  constraint lead_milestones_lead_kind_key unique (lead_id, kind),
  constraint lead_milestones_lead_owner_fkey
    foreign key (lead_id, user_id) references public.leads (id, user_id)
    on delete cascade,
  constraint lead_milestones_group_owner_fkey
    foreign key (group_id, user_id) references public.target_sources (id, user_id)
    on delete set null (group_id)
);

create index lead_milestones_owner_window_idx
  on public.lead_milestones (user_id, occurred_at desc);
create index lead_milestones_lead_idx
  on public.lead_milestones (lead_id);

-- Attribution is copied from the lead; the app never sends a group it chose.
-- The ordered funnel is enforced here so "trial confirmed" can never appear
-- without an earlier explicit conversation, and an edit cannot invert history.
create or replace function public.apply_lead_milestone_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_id text;
  v_group_id uuid;
  v_group_name text;
  v_prev timestamptz;
begin
  if tg_op = 'DELETE' then
    -- A lead cascade is already removing the whole history; only an explicit
    -- milestone delete needs the ordering guard.
    if not exists (select 1 from public.leads l where l.id = old.lead_id) then
      return old;
    end if;
    if old.kind = 'qualified' and exists (
      select 1 from public.lead_milestones m
       where m.lead_id = old.lead_id
         and m.kind in ('two_way_conversation', 'trial_use_confirmed')
    ) then
      raise exception 'Delete the later conversation/trial milestones before removing qualification.'
        using errcode = '23514';
    elsif old.kind = 'two_way_conversation' and exists (
      select 1 from public.lead_milestones m
       where m.lead_id = old.lead_id and m.kind = 'trial_use_confirmed'
    ) then
      raise exception 'Delete the confirmed trial before removing the conversation milestone.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select l.user_id, l.group_id, l.group_name
      into v_user_id, v_group_id, v_group_name
      from public.leads l
     where l.id = new.lead_id;

    if not found then
      raise exception 'Lead % does not exist for this owner.', new.lead_id
        using errcode = '23503';
    end if;

    new.user_id := v_user_id;
    new.group_id := v_group_id;
    new.group_name := v_group_name;
  else
    if new.lead_id is distinct from old.lead_id
       or new.kind is distinct from old.kind
       or new.user_id is distinct from old.user_id
       or new.group_name is distinct from old.group_name
       -- `on delete set null (group_id)` must be able to null the group when a
       -- watchlist is removed, but a live row must not be reassigned.
       or (new.group_id is distinct from old.group_id and new.group_id is not null) then
      raise exception 'Milestone lead, kind and attribution are immutable; delete and re-record instead.'
        using errcode = '23514';
    end if;
  end if;

  -- A future timestamp is a data-entry mistake, not a scheduled milestone.
  new.occurred_at := least(new.occurred_at, now());

  if new.kind = 'two_way_conversation' then
    select m.occurred_at into v_prev
      from public.lead_milestones m
     where m.lead_id = new.lead_id and m.kind = 'qualified';

    if v_prev is null then
      raise exception 'Record the qualified milestone before the two-way conversation.'
        using errcode = '23514';
    end if;
    if v_prev > new.occurred_at then
      raise exception 'The conversation cannot predate the qualified milestone.'
        using errcode = '23514';
    end if;

    if exists (
      select 1 from public.lead_milestones m
       where m.lead_id = new.lead_id
         and m.kind = 'trial_use_confirmed'
         and m.occurred_at < new.occurred_at
    ) then
      raise exception 'Moving the conversation later would invert the confirmed trial.'
        using errcode = '23514';
    end if;
  elsif new.kind = 'trial_use_confirmed' then
    select m.occurred_at into v_prev
      from public.lead_milestones m
     where m.lead_id = new.lead_id and m.kind = 'two_way_conversation';

    if v_prev is null then
      raise exception 'Record a real two-way conversation before confirming trial use.'
        using errcode = '23514';
    end if;
    if v_prev > new.occurred_at then
      raise exception 'The trial cannot predate the two-way conversation.'
        using errcode = '23514';
    end if;
  elsif new.kind = 'qualified' then
    if exists (
      select 1 from public.lead_milestones m
       where m.lead_id = new.lead_id
         and m.kind in ('two_way_conversation', 'trial_use_confirmed')
         and m.occurred_at < new.occurred_at
    ) then
      raise exception 'Moving qualification later would invert a recorded follow-up.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger lead_milestones_apply_rules
  before insert or update or delete on public.lead_milestones
  for each row execute function public.apply_lead_milestone_rules();

create trigger lead_milestones_set_updated_at
  before update on public.lead_milestones
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Actual receipts (cash in)
-- -----------------------------------------------------------------------------
create table public.lead_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.lead_owner_id(),
  lead_id uuid not null,
  group_id uuid,
  group_name text not null default '' check (length(trim(group_name)) > 0),
  kind public.lead_receipt_kind not null,
  amount_vnd bigint not null check (amount_vnd > 0),
  paid_at timestamptz not null,
  note text check (note is null or length(note) <= 500),
  -- Client-generated per submission. The unique pair makes a retry harmless
  -- while still allowing a genuinely repeated maintenance payment (new key).
  idempotency_key text not null check (length(trim(idempotency_key)) between 8 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_receipts_owner_key unique (user_id, idempotency_key),
  constraint lead_receipts_lead_owner_fkey
    foreign key (lead_id, user_id) references public.leads (id, user_id)
    on delete cascade,
  constraint lead_receipts_group_owner_fkey
    foreign key (group_id, user_id) references public.target_sources (id, user_id)
    on delete set null (group_id)
);

create index lead_receipts_owner_window_idx
  on public.lead_receipts (user_id, paid_at desc);
create index lead_receipts_lead_idx
  on public.lead_receipts (lead_id, paid_at desc);

create or replace function public.apply_lead_receipt_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_id text;
  v_group_id uuid;
  v_group_name text;
begin
  if tg_op = 'UPDATE' then
    if new.lead_id is distinct from old.lead_id
       or new.user_id is distinct from old.user_id
       or new.group_name is distinct from old.group_name
       -- Watchlist deletion nulls group_id through the FK; anything else would
       -- rewrite the payment's historical group attribution.
       or (new.group_id is distinct from old.group_id and new.group_id is not null) then
      raise exception 'Receipt lead and attribution are immutable; delete and re-record instead.'
        using errcode = '23514';
    end if;
    new.paid_at := least(new.paid_at, now());
    return new;
  end if;

  select l.user_id, l.group_id, l.group_name
    into v_user_id, v_group_id, v_group_name
    from public.leads l
   where l.id = new.lead_id;

  if not found then
    raise exception 'Lead % does not exist for this owner.', new.lead_id
      using errcode = '23503';
  end if;

  new.user_id := v_user_id;
  new.group_id := v_group_id;
  new.group_name := v_group_name;
  -- Cash cannot be received in the future; a mis-typed date is capped at now.
  new.paid_at := least(new.paid_at, now());
  return new;
end;
$$;

create trigger lead_receipts_apply_rules
  before insert or update on public.lead_receipts
  for each row execute function public.apply_lead_receipt_rules();

create trigger lead_receipts_set_updated_at
  before update on public.lead_receipts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Agreed recurring rate (shown separately; never treated as earned cash)
-- -----------------------------------------------------------------------------
create table public.lead_recurring_terms (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.lead_owner_id(),
  lead_id uuid not null,
  group_id uuid,
  group_name text not null default '' check (length(trim(group_name)) > 0),
  monthly_vnd bigint not null check (monthly_vnd > 0),
  started_on date not null,
  ended_on date,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_recurring_terms_date_check
    check (ended_on is null or ended_on >= started_on),
  constraint lead_recurring_terms_lead_owner_fkey
    foreign key (lead_id, user_id) references public.leads (id, user_id)
    on delete cascade,
  constraint lead_recurring_terms_group_owner_fkey
    foreign key (group_id, user_id) references public.target_sources (id, user_id)
    on delete set null (group_id)
);

-- One live agreement per lead; ending it preserves the old rate as history.
create unique index lead_recurring_terms_one_active_idx
  on public.lead_recurring_terms (lead_id)
  where ended_on is null;
create index lead_recurring_terms_lead_idx
  on public.lead_recurring_terms (lead_id, started_on desc);

create or replace function public.apply_lead_recurring_term_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user_id text;
  v_group_id uuid;
  v_group_name text;
begin
  if tg_op = 'UPDATE' then
    if new.lead_id is distinct from old.lead_id
       or new.user_id is distinct from old.user_id
       or new.group_name is distinct from old.group_name
       or (new.group_id is distinct from old.group_id and new.group_id is not null) then
      raise exception 'Recurring terms cannot move to another lead or group.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select l.user_id, l.group_id, l.group_name
    into v_user_id, v_group_id, v_group_name
    from public.leads l
   where l.id = new.lead_id;

  if not found then
    raise exception 'Lead % does not exist for this owner.', new.lead_id
      using errcode = '23503';
  end if;

  new.user_id := v_user_id;
  new.group_id := v_group_id;
  new.group_name := v_group_name;
  return new;
end;
$$;

create trigger lead_recurring_terms_apply_rules
  before insert or update on public.lead_recurring_terms
  for each row execute function public.apply_lead_recurring_term_rules();

create trigger lead_recurring_terms_set_updated_at
  before update on public.lead_recurring_terms
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: operator + owner, matching the Phase 1 lead contract
-- -----------------------------------------------------------------------------
alter table public.lead_milestones enable row level security;
alter table public.lead_receipts enable row level security;
alter table public.lead_recurring_terms enable row level security;

drop policy if exists "operators manage own lead milestones" on public.lead_milestones;
create policy "operators manage own lead milestones"
  on public.lead_milestones
  for all to authenticated
  using (public.is_operator() and user_id = public.lead_owner_id())
  with check (public.is_operator() and user_id = public.lead_owner_id());

drop policy if exists "operators manage own lead receipts" on public.lead_receipts;
create policy "operators manage own lead receipts"
  on public.lead_receipts
  for all to authenticated
  using (public.is_operator() and user_id = public.lead_owner_id())
  with check (public.is_operator() and user_id = public.lead_owner_id());

drop policy if exists "operators manage own lead recurring terms" on public.lead_recurring_terms;
create policy "operators manage own lead recurring terms"
  on public.lead_recurring_terms
  for all to authenticated
  using (public.is_operator() and user_id = public.lead_owner_id())
  with check (public.is_operator() and user_id = public.lead_owner_id());

-- Minimal grants. RLS is the row filter; these are the column/action gates:
--   * receipts: no UPDATE grant, so amount, paid date and (trigger-owned)
--     attribution cannot be rewritten in place; corrections delete/re-add.
--   * recurring terms: select/insert/update, no delete; "ending" is an update.
-- anon gets nothing.
revoke all on public.lead_milestones from public, anon, authenticated;
grant select, insert, update, delete on public.lead_milestones to authenticated;

revoke all on public.lead_receipts from public, anon, authenticated;
grant select, insert, delete on public.lead_receipts to authenticated;

revoke all on public.lead_recurring_terms from public, anon, authenticated;
grant select, insert, update on public.lead_recurring_terms to authenticated;

-- -----------------------------------------------------------------------------
-- 14-day per-group funnel
--
-- Window = the current Vietnam calendar day plus the previous 13 days (same
-- convention as lead_capture_report), capped at now() so a future-dated row can
-- never inflate the current period. Each stage counts DISTINCT leads with an
-- explicit event inside the window; no stage is derived from a neighboring one.
-- Counts are event counts, not cohort conversion rates: a lead qualified before
-- the window can still hold a conversation inside it. `paid_customers` is
-- distinct leads even when a lead has several receipts; `receipt_count` and the
-- cash columns count every actual receipt.
-- Only leads/both watchlists and groups with an in-window event appear; the 20
-- affiliate-only Phase 1 groups stay out of the CRM report.
-- -----------------------------------------------------------------------------
create or replace view public.v_lead_group_funnel_14d
with (security_invoker = true) as
with bounds as (
  select
    ((now() at time zone 'Asia/Ho_Chi_Minh')::date - 13) as start_day,
    (now() at time zone 'Asia/Ho_Chi_Minh')::date as end_day,
    now() as capped_at
),
group_candidates as (
  -- Leads/both watchlists appear even with zero activity so an empty funnel is
  -- visible rather than silently absent.
  select 'id:' || g.id::text as group_key, g.user_id, g.id as group_id, g.name as group_name
    from public.target_sources g
   where g.user_id = public.lead_owner_id()
     and g.capture_mode in ('leads', 'both')
  union all
  select case when m.group_id is not null then 'id:' || m.group_id::text else 'name:' || m.group_name end,
         m.user_id, m.group_id, m.group_name
    from public.lead_milestones m, bounds b
   where m.user_id = public.lead_owner_id()
     and m.occurred_at >= (b.start_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
     and m.occurred_at <= b.capped_at
  union all
  select case when r.group_id is not null then 'id:' || r.group_id::text else 'name:' || r.group_name end,
         r.user_id, r.group_id, r.group_name
    from public.lead_receipts r, bounds b
   where r.user_id = public.lead_owner_id()
     and r.paid_at >= (b.start_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
     and r.paid_at <= b.capped_at
),
groups as (
  select
    group_key,
    user_id,
    (array_agg(group_id) filter (where group_id is not null))[1] as group_id,
    min(group_name) as group_name
  from group_candidates
  group by group_key, user_id
),
milestones as (
  select
    case when m.group_id is not null then 'id:' || m.group_id::text else 'name:' || m.group_name end as group_key,
    m.lead_id,
    m.kind
  from public.lead_milestones m, bounds b
  where m.user_id = public.lead_owner_id()
    and m.occurred_at >= (b.start_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
    and m.occurred_at <= b.capped_at
),
receipts as (
  select
    case when r.group_id is not null then 'id:' || r.group_id::text else 'name:' || r.group_name end as group_key,
    r.lead_id,
    r.kind,
    r.amount_vnd
  from public.lead_receipts r, bounds b
  where r.user_id = public.lead_owner_id()
    and r.paid_at >= (b.start_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
    and r.paid_at <= b.capped_at
),
recurring as (
  select
    case when t.group_id is not null then 'id:' || t.group_id::text else 'name:' || t.group_name end as group_key,
    t.monthly_vnd
  from public.lead_recurring_terms t, bounds b
  where t.user_id = public.lead_owner_id()
    and (t.ended_on is null or t.ended_on >= b.end_day)
    and t.started_on <= b.end_day
),
milestone_counts as (
  select
    group_key,
    count(distinct lead_id) filter (where kind = 'qualified') as qualified_leads,
    count(distinct lead_id) filter (where kind = 'two_way_conversation') as two_way_leads,
    count(distinct lead_id) filter (where kind = 'trial_use_confirmed') as trial_confirmed_leads
  from milestones
  group by group_key
),
receipt_counts as (
  select
    group_key,
    count(distinct lead_id) as paid_customers,
    count(*) as receipt_count,
    coalesce(sum(amount_vnd) filter (where kind = 'template'), 0) as cash_template_vnd,
    coalesce(sum(amount_vnd) filter (where kind = 'setup'), 0) as cash_setup_vnd,
    coalesce(sum(amount_vnd) filter (where kind = 'maintenance'), 0) as cash_maintenance_vnd,
    coalesce(sum(amount_vnd), 0) as cash_total_vnd
  from receipts
  group by group_key
),
recurring_counts as (
  select group_key, sum(monthly_vnd) as recurring_monthly_vnd
  from recurring
  group by group_key
)
select
  g.user_id,
  g.group_id,
  g.group_name,
  coalesce(m.qualified_leads, 0) as qualified_leads,
  coalesce(m.two_way_leads, 0) as two_way_leads,
  coalesce(m.trial_confirmed_leads, 0) as trial_confirmed_leads,
  coalesce(r.paid_customers, 0) as paid_customers,
  coalesce(r.receipt_count, 0) as receipt_count,
  coalesce(r.cash_template_vnd, 0) as cash_template_vnd,
  coalesce(r.cash_setup_vnd, 0) as cash_setup_vnd,
  coalesce(r.cash_maintenance_vnd, 0) as cash_maintenance_vnd,
  coalesce(r.cash_total_vnd, 0) as cash_total_vnd,
  coalesce(x.recurring_monthly_vnd, 0) as recurring_monthly_vnd,
  -- Safe denominator: a lead with no receipt has no average, not 0/0.
  round(coalesce(r.cash_total_vnd, 0)::numeric / nullif(r.paid_customers, 0), 0)
    as avg_cash_per_paid_customer
from groups g
left join milestone_counts m on m.group_key = g.group_key
left join receipt_counts r on r.group_key = g.group_key
left join recurring_counts x on x.group_key = g.group_key;

revoke all on public.v_lead_group_funnel_14d from public, anon, authenticated;
grant select on public.v_lead_group_funnel_14d to authenticated;

-- Trigger functions return `trigger` and are never callable through PostgREST;
-- no EXECUTE grant is needed (and revoking one would not stop trigger firing).

comment on table public.lead_milestones is
  'Explicit CRM milestones with operator-supplied historical timestamps; absence means not reached.';
comment on type public.lead_milestone_kind is
  'qualified -> real two-way conversation -> customer confirms trial use. Sending a file/trial is not a confirmed trial.';
comment on table public.lead_receipts is
  'Actual cash receipts in VND. (user_id, idempotency_key) makes retries harmless; repeat payments use new keys.';
comment on column public.lead_receipts.idempotency_key is
  'Client-generated per submission; retries dedupe, a genuinely repeated payment uses a new key.';
comment on type public.lead_receipt_kind is
  'Receipt category: template/file, setup/delivery, or maintenance. Cash is always the actual amount, never inferred.';
comment on table public.lead_recurring_terms is
  'Agreed monthly maintenance rate. Reported separately from cash; never summed into revenue or treated as MRR.';
comment on view public.v_lead_group_funnel_14d is
  'Rolling 14-day funnel per group. Distinct leads per explicit milestone; cash counts every receipt; ratios guarded by nullif.';
