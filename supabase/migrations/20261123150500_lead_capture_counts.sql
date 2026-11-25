-- One counter per group, Vietnam calendar day and outcome; no rejected post text/URL.
grant execute on function public.lead_owner_id() to service_role;
create table public.lead_capture_counts (
  user_id text not null,
  source_id uuid not null,
  day date not null,
  outcome text not null check (outcome in ('empty','too_short','no_keyword','duplicate','status_changed','storage_error','pending_review','classified','alerted')),
  attempts bigint not null check (attempts > 0),
  primary key (user_id, source_id, day, outcome),
  foreign key (source_id,user_id) references public.target_sources(id,user_id) on delete cascade
);
alter table public.lead_capture_counts enable row level security;
revoke all on public.lead_capture_counts from public, anon, authenticated;
grant select on public.lead_capture_counts to authenticated;
grant select,insert,update on public.lead_capture_counts to service_role;
create policy "operator reads own lead diagnostics" on public.lead_capture_counts for select to authenticated
using (public.is_operator() and user_id = public.lead_owner_id());

create function public.record_lead_capture(p_source_id uuid,p_outcome text) returns void
language sql security invoker set search_path = '' as $$
  insert into public.lead_capture_counts (user_id,source_id,day,outcome,attempts)
  values (public.lead_owner_id(), p_source_id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_outcome, 1)
  on conflict (user_id,source_id,day,outcome) do update set attempts=public.lead_capture_counts.attempts+1;
$$;
revoke all on function public.record_lead_capture(uuid,text) from public,anon,authenticated;
grant execute on function public.record_lead_capture(uuid,text) to service_role;

create function public.lead_capture_report() returns table(source_id uuid, group_name text, outcome text, attempts bigint)
language sql stable security invoker set search_path = '' as $$
  select c.source_id,g.name,c.outcome,sum(c.attempts)::bigint
  from public.lead_capture_counts c join public.target_sources g on (g.id,g.user_id)=(c.source_id,c.user_id)
  where c.user_id=public.lead_owner_id() and c.day between (now() at time zone 'Asia/Ho_Chi_Minh')::date - 13 and (now() at time zone 'Asia/Ho_Chi_Minh')::date
  group by c.source_id,g.name,c.outcome order by g.name,c.source_id,c.outcome;
$$;
revoke all on function public.lead_capture_report() from public,anon;
grant execute on function public.lead_capture_report() to authenticated,service_role;
