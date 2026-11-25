-- Never backfill estimates as actual payouts. NULL = no net amount verified at order granularity.
alter table public.affiliate_conversions add column validated_commission numeric(14,2)
  check (validated_commission >= 0);

create function public.settled_product_ranking(p_since timestamptz default null)
returns table(product_id uuid, product_name text, settled_orders bigint, net_commission numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id,p.name,count(*),sum(c.validated_commission)
  from public.affiliate_conversions c
  join public.comment_tasks t on c.task_id=t.id or (c.task_id is null and c.sub_id=t.sub_id_code)
  join public.products p on p.id=t.matched_product_id
  where c.status='settled' and c.validated_commission is not null
    and (p_since is null or c.converted_at>=p_since)
  group by p.id,p.name
  order by sum(c.validated_commission) desc,p.id limit 10;
$$;
revoke all on function public.settled_product_ranking(timestamptz) from public,anon;
grant execute on function public.settled_product_ranking(timestamptz) to authenticated;
