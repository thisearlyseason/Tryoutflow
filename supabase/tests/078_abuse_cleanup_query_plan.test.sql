begin;

set local search_path=extensions,public;
select plan(12);

create function pg_temp.plan_nodes(explanation jsonb) returns table(node jsonb)
language sql immutable set search_path='' as $$
  with recursive nodes(node) as (
    select explanation->0->'Plan'
    union all
    select child.value
    from nodes parent
    cross join lateral jsonb_array_elements(
      coalesce(parent.node->'Plans','[]'::jsonb)
    ) child
  )
  select nodes.node from nodes;
$$;

create function pg_temp.explain_abuse_cleanup(p_now_at timestamptz) returns jsonb
language plpgsql volatile set search_path='' as $$
declare explanation jsonb;
begin
  execute $query$
    explain (analyze,costs off,timing off,summary off,format json)
    with expired_rows as(
      select item.ctid as row_id
      from private.abuse_rate_limits item
      where item.expires_at<=$1
      order by item.expires_at,item.scope,item.subject_digest,item.address_digest
      for update skip locked
      limit 100
    )
    delete from private.abuse_rate_limits item
    using expired_rows expired
    where item.ctid=expired.row_id
  $query$ into explanation using p_now_at;
  return explanation;
end;
$$;

create function pg_temp.explain_bot_cleanup(p_now_at timestamptz) returns jsonb
language plpgsql volatile set search_path='' as $$
declare explanation jsonb;
begin
  execute $query$
    explain (analyze,costs off,timing off,summary off,format json)
    with expired_rows as(
      select receipt.ctid as row_id
      from private.bot_token_receipts receipt
      where receipt.expires_at<=$1
      order by receipt.expires_at,receipt.action,receipt.token_digest
      for update skip locked
      limit 100
    )
    delete from private.bot_token_receipts receipt
    using expired_rows expired
    where receipt.ctid=expired.row_id
  $query$ into explanation using p_now_at;
  return explanation;
end;
$$;

delete from private.abuse_rate_limits;
delete from private.bot_token_receipts;

insert into private.abuse_rate_limits(
  subject_digest,address_digest,scope,attempts,window_started_at,expires_at
)
select
  encode(extensions.digest('plan-rate-subject-'||item,'sha256'),'hex'),
  encode(extensions.digest('plan-rate-address-'||item,'sha256'),'hex'),
  'registration_reissue',1,'2025-01-01 00:00:00+00',
  case when item<=150 then '2025-01-02 00:00:00+00'::timestamptz
    else '2999-01-01 00:00:00+00'::timestamptz end
from generate_series(1,50150) item;

insert into private.bot_token_receipts(token_digest,action,consumed_at,expires_at)
select
  encode(extensions.digest('plan-bot-token-'||item,'sha256'),'hex'),
  'registration_reissue','2025-01-01 00:00:00+00',
  case when item<=150 then '2025-01-02 00:00:00+00'::timestamptz
    else '2999-01-01 00:00:00+00'::timestamptz end
from generate_series(1,50150) item;

analyze private.abuse_rate_limits;
analyze private.bot_token_receipts;

create temporary table abuse_cleanup_plan as
select pg_temp.explain_abuse_cleanup('2026-09-01 00:00:00+00') explanation;
create temporary table bot_cleanup_plan as
select pg_temp.explain_bot_cleanup('2026-09-01 00:00:00+00') explanation;

select ok(not exists(
  select 1 from abuse_cleanup_plan,
  lateral pg_temp.plan_nodes(explanation) where node->>'Node Type'='Seq Scan'
),'the exact abuse limiter cleanup performs no sequential scan');
select ok(not exists(
  select 1 from abuse_cleanup_plan,
  lateral pg_temp.plan_nodes(explanation) where node->>'Node Type'='Sort'
),'the exact abuse limiter cleanup performs no sort');
select ok(exists(
  select 1 from abuse_cleanup_plan,
  lateral pg_temp.plan_nodes(explanation)
  where node->>'Node Type'='Index Scan'
    and node->>'Index Name'='abuse_rate_limits_expiry_cleanup_idx'
),'the exact abuse limiter cleanup uses its expiry-order index');
select cmp_ok((
  select coalesce(sum(
    ((node->>'Actual Rows')::numeric+
      coalesce((node->>'Rows Removed by Filter')::numeric,0))*
    (node->>'Actual Loops')::numeric
  ),0)::bigint
  from abuse_cleanup_plan,lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='abuse_rate_limits'
    and node->>'Node Type' in('Seq Scan','Index Scan','Index Only Scan')
),'<=',100::bigint,'the abuse cleanup selection reads at most its fixed batch bound');
select is((select count(*) from private.abuse_rate_limits),50050::bigint,
  'the abuse cleanup deletes exactly 100 rows from the large fixture');
select is((select count(*) from private.abuse_rate_limits
  where expires_at<='2026-09-01 00:00:00+00'),50::bigint,
  'the abuse cleanup leaves the remaining 50 expired rows for a later batch');

select ok(not exists(
  select 1 from bot_cleanup_plan,
  lateral pg_temp.plan_nodes(explanation) where node->>'Node Type'='Seq Scan'
),'the exact bot receipt cleanup performs no sequential scan');
select ok(not exists(
  select 1 from bot_cleanup_plan,
  lateral pg_temp.plan_nodes(explanation) where node->>'Node Type'='Sort'
),'the exact bot receipt cleanup performs no sort');
select ok(exists(
  select 1 from bot_cleanup_plan,
  lateral pg_temp.plan_nodes(explanation)
  where node->>'Node Type'='Index Scan'
    and node->>'Index Name'='bot_token_receipts_expiry_cleanup_idx'
),'the exact bot receipt cleanup uses its expiry-order index');
select cmp_ok((
  select coalesce(sum(
    ((node->>'Actual Rows')::numeric+
      coalesce((node->>'Rows Removed by Filter')::numeric,0))*
    (node->>'Actual Loops')::numeric
  ),0)::bigint
  from bot_cleanup_plan,lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='bot_token_receipts'
    and node->>'Node Type' in('Seq Scan','Index Scan','Index Only Scan')
),'<=',100::bigint,'the bot cleanup selection reads at most its fixed batch bound');
select is((select count(*) from private.bot_token_receipts),50050::bigint,
  'the bot cleanup deletes exactly 100 rows from the large fixture');
select is((select count(*) from private.bot_token_receipts
  where expires_at<='2026-09-01 00:00:00+00'),50::bigint,
  'the bot cleanup leaves the remaining 50 expired rows for a later batch');

select * from finish();
rollback;
