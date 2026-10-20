-- Checkout results are short-lived bearer capabilities. Bind every new attempt to the exact
-- initiating owner, retain completed attempts as the organization-wide fence, and redact expired
-- capability material through both the worker and verified subscription activation.

create function private.is_valid_billing_session_url(
  p_session_id text,p_url text,p_kind text
) returns boolean language sql immutable strict set search_path='' as $$
  select case p_kind
    when 'checkout' then
      p_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{8,200}$'
      and p_url !~ '[[:cntrl:]]'
      and p_url ~ '^https://checkout[.]stripe[.]com/c/pay/cs_(test|live)_[A-Za-z0-9]{8,200}(#[A-Za-z0-9_-]+)?$'
      and (pg_catalog.strpos(p_url,'#')=0
        or pg_catalog.char_length(pg_catalog.split_part(p_url,'#',2)) between 1 and 2048)
      and pg_catalog.substring(
        p_url,'^https://checkout[.]stripe[.]com/c/pay/(cs_(test|live)_[A-Za-z0-9]{8,200})'
      )=p_session_id
    when 'portal' then
      p_session_id ~ '^bps_[A-Za-z0-9]{8,200}$'
      and p_url !~ '[[:cntrl:]]'
      and p_url ~ '^https://billing[.]stripe[.]com/p/session/bps_[A-Za-z0-9]{8,200}$'
      and pg_catalog.substring(
        p_url,'^https://billing[.]stripe[.]com/p/session/(bps_[A-Za-z0-9]{8,200})$'
      )=p_session_id
    else false
  end
$$;
revoke all on function private.is_valid_billing_session_url(text,text,text)
from public,anon,authenticated,service_role;

alter table public.subscription_checkout_intents
  add column initiating_owner_user_id uuid references auth.users(id) on delete cascade;

-- Legacy rows have no trustworthy initiating actor. Fail closed, redact their bearer material,
-- and retain only their non-sensitive replay tombstone instead of fabricating ownership.
update public.subscription_checkout_intents
set state='expired',provider_session_id=null,result_url=null,completed_at=null
where state in('pending','completed');

alter table public.subscription_checkout_intents
  drop constraint subscription_checkout_intents_result,
  add constraint subscription_checkout_intents_owner_bound check(
    initiating_owner_user_id is not null or state in('failed','expired')
  ),
  add constraint subscription_checkout_intents_result check(
    (state='completed' and provider_session_id is not null and result_url is not null
      and private.is_valid_billing_session_url(provider_session_id,result_url,'checkout')
      and completed_at is not null)
    or (state<>'completed' and provider_session_id is null and result_url is null and completed_at is null)
  );

drop index public.subscription_checkout_intents_one_pending_per_org;
create unique index subscription_checkout_intents_one_active_per_org
on public.subscription_checkout_intents(organization_id)
where state in('pending','completed');

drop function public.reserve_subscription_checkout_intent(uuid,uuid,text);
create function public.reserve_subscription_checkout_intent(
  p_organization_id uuid,p_client_attempt_id uuid,p_plan_key text,
  p_initiating_owner_user_id uuid
) returns table(outcome text,idempotency_key text,session_id text,result_url text)
language plpgsql security definer set search_path='' as $$
declare account public.subscription_accounts%rowtype;
  existing public.subscription_checkout_intents%rowtype;
  active public.subscription_checkout_intents%rowtype;
  generated_key text;
begin
  if p_organization_id is null or p_client_attempt_id is null
    or p_client_attempt_id='00000000-0000-0000-0000-000000000000'::uuid
    or p_plan_key is null or p_plan_key not in('team','club','association')
    or p_initiating_owner_user_id is null
    or p_initiating_owner_user_id<>auth.uid()
  then raise exception 'invalid checkout intent' using errcode='22023'; end if;
  if not public.is_active_organization_member(p_organization_id,array['owner'])
  then return query select 'forbidden'::text,null::text,null::text,null::text; return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('subscription-checkout:'||p_organization_id::text,0)
  );
  perform 1 from public.organization_members
  where organization_id=p_organization_id and user_id=p_initiating_owner_user_id
    and role='owner' and status='active'
  for key share;
  if not found
  then return query select 'forbidden'::text,null::text,null::text,null::text; return; end if;
  select * into account from public.subscription_accounts
    where organization_id=p_organization_id for update;
  if not found then return query select 'forbidden'::text,null::text,null::text,null::text; return; end if;

  update public.subscription_checkout_intents set state='expired',provider_session_id=null,
    result_url=null,completed_at=null
  where organization_id=p_organization_id and state in('pending','completed')
    and expires_at<=clock_timestamp();

  if account.provider_subscription_id is not null
    and account.state in('trialing','active','past_due')
  then
    if account.state in('trialing','active') then
      update public.subscription_checkout_intents set state='expired',provider_session_id=null,
        result_url=null,completed_at=null
      where organization_id=p_organization_id and state in('pending','completed');
    end if;
    return query select 'subscription_exists'::text,null::text,null::text,null::text; return;
  end if;

  select * into existing from public.subscription_checkout_intents
  where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id for update;
  if found then
    if existing.initiating_owner_user_id is distinct from p_initiating_owner_user_id then
      return query select 'forbidden'::text,null::text,null::text,null::text; return;
    elsif existing.plan_key<>p_plan_key then
      return query select 'conflict'::text,null::text,null::text,null::text; return;
    elsif existing.state='completed' then
      return query select 'completed'::text,existing.idempotency_key,
        existing.provider_session_id,existing.result_url; return;
    elsif existing.state='pending' then
      return query select 'pending'::text,existing.idempotency_key,null::text,null::text; return;
    else
      return query select existing.state,existing.idempotency_key,null::text,null::text; return;
    end if;
  end if;

  select * into active from public.subscription_checkout_intents
    where organization_id=p_organization_id and state in('pending','completed') for update;
  if found then
    return query select 'in_progress'::text,null::text,null::text,null::text; return;
  end if;

  generated_key:='tryoutflow:'||pg_catalog.encode(extensions.digest(
    p_organization_id::text||':'||p_client_attempt_id::text||':'||p_plan_key,'sha256'),'hex');
  insert into public.subscription_checkout_intents(
    organization_id,client_attempt_id,plan_key,idempotency_key,initiating_owner_user_id
  ) values(
    p_organization_id,p_client_attempt_id,p_plan_key,generated_key,p_initiating_owner_user_id
  );
  return query select 'reserved'::text,generated_key,null::text,null::text;
end $$;

create or replace function public.complete_subscription_checkout_intent(
  p_organization_id uuid,p_client_attempt_id uuid,p_session_id text,p_result_url text
) returns text language plpgsql security definer set search_path='' as $$
declare intent public.subscription_checkout_intents%rowtype;
begin
  if p_organization_id is null or p_client_attempt_id is null
    or p_session_id is null or p_result_url is null
    or not private.is_valid_billing_session_url(p_session_id,p_result_url,'checkout')
  then raise exception 'invalid checkout result' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('subscription-checkout:'||p_organization_id::text,0)
  );
  select * into intent from public.subscription_checkout_intents
    where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id for update;
  if not found then return 'not_found'; end if;
  if intent.state='completed' then
    if intent.provider_session_id=p_session_id and intent.result_url=p_result_url then return 'completed'; end if;
    return 'conflict';
  end if;
  if intent.state<>'pending' or intent.expires_at<=clock_timestamp() then
    if intent.state='pending' then
      update public.subscription_checkout_intents set state='expired',provider_session_id=null,
        result_url=null,completed_at=null
      where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id;
    end if;
    return 'expired';
  end if;
  update public.subscription_checkout_intents set state='completed',provider_session_id=p_session_id,
    result_url=p_result_url,completed_at=clock_timestamp()
  where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id;
  return 'completed';
end $$;

create function public.purge_expired_subscription_checkout_intents(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if p_limit is null or p_limit<1 or p_limit>500
  then raise exception 'invalid purge limit' using errcode='22023'; end if;
  with candidates as (
    select organization_id,client_attempt_id
    from public.subscription_checkout_intents
    where state in('pending','completed') and expires_at<=clock_timestamp()
    order by expires_at,organization_id,client_attempt_id
    limit p_limit for update skip locked
  ), redacted as (
    update public.subscription_checkout_intents intent
    set state='expired',provider_session_id=null,result_url=null,completed_at=null
    from candidates
    where intent.organization_id=candidates.organization_id
      and intent.client_attempt_id=candidates.client_attempt_id
    returning 1
  ) select pg_catalog.count(*)::integer into changed from redacted;
  return changed;
end $$;

create function private.expire_checkout_intents_on_verified_subscription()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider_subscription_id is not null and new.state in('trialing','active') then
    update public.subscription_checkout_intents set state='expired',provider_session_id=null,
      result_url=null,completed_at=null
    where organization_id=new.organization_id and state in('pending','completed');
  end if;
  return new;
end $$;
create trigger expire_checkout_intents_on_verified_subscription
after insert or update of provider_subscription_id,state on public.subscription_accounts
for each row execute function private.expire_checkout_intents_on_verified_subscription();

create function private.expire_checkout_intents_on_owner_offboarding()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.role='owner' and old.status='active'
    and (tg_op='DELETE' or new.role<>'owner' or new.status<>'active')
  then
    update public.subscription_checkout_intents set state='expired',provider_session_id=null,
      result_url=null,completed_at=null
    where organization_id=old.organization_id and initiating_owner_user_id=old.user_id
      and state in('pending','completed');
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger expire_checkout_intents_on_owner_offboarding
after delete or update of role,status on public.organization_members
for each row execute function private.expire_checkout_intents_on_owner_offboarding();

revoke all on function public.reserve_subscription_checkout_intent(uuid,uuid,text,uuid),
  public.purge_expired_subscription_checkout_intents(integer),
  private.expire_checkout_intents_on_verified_subscription(),
  private.expire_checkout_intents_on_owner_offboarding()
from public,anon,authenticated,service_role;
grant execute on function public.reserve_subscription_checkout_intent(uuid,uuid,text,uuid)
to authenticated;
grant execute on function public.purge_expired_subscription_checkout_intents(integer)
to service_role;
