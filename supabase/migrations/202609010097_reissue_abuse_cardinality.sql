-- Keep unauthenticated abuse evidence bounded without changing the narrow
-- service-only RPC surface. Cleanup is opportunistic, lock-safe, and capped so
-- a request never performs unbounded retention work.

create or replace function public.consume_abuse_rate_limit(
  p_subject_digest text,
  p_address_digest text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
) returns table(allowed boolean,remaining integer,retry_after_seconds integer)
language plpgsql security definer set search_path=''
as $$
declare
  counter private.abuse_rate_limits%rowtype;
  now_at timestamptz:=clock_timestamp();
begin
  if p_subject_digest!~'^[0-9a-f]{64}$' or p_address_digest!~'^[0-9a-f]{64}$'
    or p_scope not in('auth_sign_in','auth_sign_up','auth_recovery','auth_verification',
      'public_registration','registration_confirmation','registration_reissue')
    or p_limit not between 1 and 100 or p_window_seconds not between 10 and 3600
  then raise invalid_parameter_value using message='invalid abuse rate-limit request'; end if;

  if pg_try_advisory_xact_lock(hashtextextended('abuse-rate-expiry-purge',0)) then
    with expired_rows as(
      select item.ctid as row_id
      from private.abuse_rate_limits item
      where item.expires_at<=now_at
      order by item.expires_at,item.scope,item.subject_digest,item.address_digest
      for update skip locked
      limit 100
    )
    delete from private.abuse_rate_limits item
    using expired_rows expired
    where item.ctid=expired.row_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','abuse',p_scope,p_subject_digest,p_address_digest),0));
  select * into counter from private.abuse_rate_limits item
    where item.subject_digest=p_subject_digest and item.address_digest=p_address_digest and item.scope=p_scope
    for update;
  if not found or counter.expires_at<=now_at then
    insert into private.abuse_rate_limits(subject_digest,address_digest,scope,attempts,window_started_at,expires_at)
    values(p_subject_digest,p_address_digest,p_scope,1,now_at,now_at+make_interval(secs=>p_window_seconds))
    on conflict(subject_digest,address_digest,scope) do update
      set attempts=1,window_started_at=excluded.window_started_at,expires_at=excluded.expires_at
    returning * into counter;
  else
    update private.abuse_rate_limits item set attempts=least(item.attempts+1,101)
      where item.subject_digest=p_subject_digest and item.address_digest=p_address_digest and item.scope=p_scope
      returning * into counter;
  end if;
  return query select counter.attempts<=p_limit,greatest(p_limit-counter.attempts,0),
    greatest(1,ceil(extract(epoch from counter.expires_at-now_at))::integer);
end;
$$;

create or replace function public.consume_bot_token_once(
  p_token_digest text,
  p_action text,
  p_ttl_seconds integer
) returns table(consumed boolean)
language plpgsql security definer set search_path=''
as $$
declare now_at timestamptz:=clock_timestamp();
begin
  if p_token_digest!~'^[0-9a-f]{64}$'
    or p_action not in('sign_in','sign_up','recovery','verification','public_registration','registration_confirmation','registration_reissue')
    or p_ttl_seconds not between 30 and 300
  then raise invalid_parameter_value using message='invalid bot-token receipt request'; end if;

  if pg_try_advisory_xact_lock(hashtextextended('bot-token-expiry-purge',0)) then
    with expired_rows as(
      select receipt.ctid as row_id
      from private.bot_token_receipts receipt
      where receipt.expires_at<=now_at
      order by receipt.expires_at,receipt.action,receipt.token_digest
      for update skip locked
      limit 100
    )
    delete from private.bot_token_receipts receipt
    using expired_rows expired
    where receipt.ctid=expired.row_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','bot-token',p_action,p_token_digest),0));
  delete from private.bot_token_receipts receipt
    where receipt.token_digest=p_token_digest and receipt.action=p_action and receipt.expires_at<=now_at;
  insert into private.bot_token_receipts(token_digest,action,expires_at)
  values(p_token_digest,p_action,now_at+make_interval(secs=>p_ttl_seconds))
  on conflict do nothing;
  return query select found;
end;
$$;

revoke all on function public.consume_abuse_rate_limit(text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.consume_bot_token_once(text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.consume_abuse_rate_limit(text,text,text,integer,integer)
  to service_role;
grant execute on function public.consume_bot_token_once(text,text,integer)
  to service_role;
