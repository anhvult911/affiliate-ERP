-- Negative cache for the radar.
--
-- docs/REVIEW.md P2-4. Ingest only remembered posts it turned into a task: dedupe runs
-- against `comment_tasks.post_url`, so a post judged below the match threshold was
-- re-embedded and re-ranked on every scan of that source. The first twelve posts of a
-- busy group are almost static, so a 15-minute interval meant a Gemini embed + match
-- per old post, per scan — quota burned to reach the same conclusion.
--
-- Relationship to `radar_scans` (P1-3): that table records *scan runs* per account and
-- source (rotation, per-account budget, blind-radar detection). This one records
-- *judgements about a post*, which is a different question and outlives a run. Keeping
-- them apart means a scan can be counted even when every post is a cache hit.
--
-- Rollback: drop the table. Ingest falls back to always scoring, which is the current
-- behaviour.

create table if not exists public.radar_seen (
  -- Normalised by src/lib/worker/url.ts before it reaches this table.
  post_url text primary key,
  source_id uuid references public.target_sources (id) on delete cascade,
  /** Match score that produced the skip; kept so the threshold can be tuned later. */
  score numeric(4, 3) check (score is null or (score >= 0 and score <= 1)),
  reason text,
  seen_at timestamptz not null default now()
);

create index if not exists radar_seen_seen_at_idx on public.radar_seen (seen_at desc);

alter table public.radar_seen enable row level security;

drop policy if exists "operators read radar seen" on public.radar_seen;
create policy "operators read radar seen"
  on public.radar_seen for select to authenticated
  using (public.is_operator());

comment on table public.radar_seen is
  'Posts already judged and not queued, so a rescan skips the Gemini call (P2-4).';
