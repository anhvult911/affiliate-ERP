-- =============================================================================
-- Per-watchlist capture routing
--
-- Replaces the process-wide RADAR_GROUP_MODE environment switch with an explicit
-- column so two groups can feed different pipelines at the same time:
--
--   affiliate -> product matching + comment_tasks only
--   leads     -> lead hunter + Mini CRM only (no product/Gemini key needed)
--   both      -> run both consumers for every post
--
-- Only Facebook groups may route leads: fanpages, KOLs and forums are affiliate
-- sources. The check constraint keeps that invariant in the database, and the
-- ingest route mirrors it so a stale worker cannot make a fanpage write a lead.
--
-- Existing rows are the Phase 1 production consumer groups (20 groups across
-- me_bim/gia_dung). They keep today's affiliate behaviour explicitly; new rows
-- default to affiliate too. Operators opt a group into leads/both in /radar.
--
-- Rollback: drop the check constraint and column, then drop the enum type.
-- =============================================================================

create type public.source_capture_mode as enum ('affiliate', 'leads', 'both');

alter table public.target_sources
  add column capture_mode public.source_capture_mode not null default 'affiliate';

-- The NOT NULL default backfills every existing row in place: the 20 Phase 1
-- consumer groups across me_bim/gia_dung stay affiliate, and new groups inherit
-- the same default until an operator opts them into leads/both in /radar.

alter table public.target_sources
  drop constraint if exists target_sources_group_capture_mode_check;
alter table public.target_sources
  add constraint target_sources_group_capture_mode_check
  check (source_type = 'group' or capture_mode = 'affiliate');

comment on type public.source_capture_mode is
  'Per-watchlist routing: affiliate matching, lead hunting, or both.';

comment on column public.target_sources.capture_mode is
  'Explicit capture pipeline for this source. Non-group sources must stay affiliate.';
