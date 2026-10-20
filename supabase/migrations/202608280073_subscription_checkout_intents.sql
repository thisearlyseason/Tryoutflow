-- A checkout is reserved durably before Stripe is called. Provider delivery remains non-authoritative:
-- only a later signature-verified webhook may change subscription_accounts or entitlements.

create table public.subscription_checkout_intents (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_attempt_id uuid not null,
  plan_key text not null,
  idempotency_key text not null unique,
  state text not null default 'pending',
  provider_session_id text,
  result_url text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
  completed_at timestamptz,
  primary key(organization_id,client_attempt_id),
  constraint subscription_checkout_intents_plan check(plan_key in('team','club','association')),
  constraint subscription_checkout_intents_key check(idempotency_key ~ '^tryoutflow:[0-9a-f]{64}$'),
  constraint subscription_checkout_intents_state check(state in('pending','completed','failed','expired')),
  constraint subscription_checkout_intents_attempt check(client_attempt_id<>'00000000-0000-0000-0000-000000000000'::uuid),
  constraint subscription_checkout_intents_expiry check(expires_at>created_at),
  constraint subscription_checkout_intents_result check(
    (state='completed' and provider_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]{8,200}$'
      and result_url ~ '^https://checkout[.]stripe[.]com/c/pay/' and completed_at is not null)
    or (state<>'completed' and provider_session_id is null and result_url is null and completed_at is null)
  )
);

create unique index subscription_checkout_intents_one_pending_per_org
on public.subscription_checkout_intents(organization_id) where state='pending';
create index subscription_checkout_intents_expiry_idx
on public.subscription_checkout_intents(expires_at) where state in('pending','completed');

alter table public.subscription_checkout_intents enable row level security;
revoke all on public.subscription_checkout_intents from public,anon,authenticated,service_role;

create function public.reserve_subscription_checkout_intent(
  p_organization_id uuid,p_client_attempt_id uuid,p_plan_key text
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
  then raise exception 'invalid checkout intent' using errcode='22023'; end if;
  if not public.is_active_organization_member(p_organization_id,array['owner'])
  then return query select 'forbidden'::text,null::text,null::text,null::text; return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('subscription-checkout:'||p_organization_id::text,0)
  );
  select * into account from public.subscription_accounts
    where organization_id=p_organization_id for update;
  if not found then return query select 'forbidden'::text,null::text,null::text,null::text; return; end if;

  update public.subscription_checkout_intents set state='expired',provider_session_id=null,
    result_url=null,completed_at=null
  where organization_id=p_organization_id and state in('pending','completed')
    and expires_at<=clock_timestamp();

  select * into existing from public.subscription_checkout_intents
  where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id for update;
  if found then
    if existing.expires_at<=clock_timestamp() and existing.state in('pending','completed') then
      update public.subscription_checkout_intents set state='expired',provider_session_id=null,
        result_url=null,completed_at=null
      where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id;
      return query select 'expired'::text,existing.idempotency_key,null::text,null::text; return;
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

  if account.provider_subscription_id is not null
    and account.state in('trialing','active','past_due')
  then return query select 'subscription_exists'::text,null::text,null::text,null::text; return; end if;
  select * into active from public.subscription_checkout_intents
    where organization_id=p_organization_id and state='pending' for update;
  if found then
    return query select 'in_progress'::text,active.idempotency_key,null::text,null::text; return;
  end if;

  generated_key:='tryoutflow:'||pg_catalog.encode(extensions.digest(
    p_organization_id::text||':'||p_client_attempt_id::text||':'||p_plan_key,'sha256'),'hex');
  insert into public.subscription_checkout_intents(
    organization_id,client_attempt_id,plan_key,idempotency_key
  ) values(p_organization_id,p_client_attempt_id,p_plan_key,generated_key);
  return query select 'reserved'::text,generated_key,null::text,null::text;
end $$;

create function public.complete_subscription_checkout_intent(
  p_organization_id uuid,p_client_attempt_id uuid,p_session_id text,p_result_url text
) returns text language plpgsql security definer set search_path='' as $$
declare intent public.subscription_checkout_intents%rowtype;
begin
  if p_organization_id is null or p_client_attempt_id is null
    or p_session_id is null or p_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]{8,200}$'
    or p_result_url is null or p_result_url !~ '^https://checkout[.]stripe[.]com/c/pay/'
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
    if intent.state='pending' then update public.subscription_checkout_intents set state='expired'
      where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id; end if;
    return 'expired';
  end if;
  update public.subscription_checkout_intents set state='completed',provider_session_id=p_session_id,
    result_url=p_result_url,completed_at=clock_timestamp()
  where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id;
  return 'completed';
end $$;

create function public.fail_subscription_checkout_intent(
  p_organization_id uuid,p_client_attempt_id uuid
) returns text language plpgsql security definer set search_path='' as $$
declare current_state text;
begin
  if p_organization_id is null or p_client_attempt_id is null
  then raise exception 'invalid checkout failure' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('subscription-checkout:'||p_organization_id::text,0)
  );
  select state into current_state from public.subscription_checkout_intents
    where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id for update;
  if not found then return 'not_found'; end if;
  if current_state='pending' then
    update public.subscription_checkout_intents set state='failed'
      where organization_id=p_organization_id and client_attempt_id=p_client_attempt_id;
    return 'failed';
  end if;
  return current_state;
end $$;

revoke all on function public.reserve_subscription_checkout_intent(uuid,uuid,text),
  public.complete_subscription_checkout_intent(uuid,uuid,text,text),
  public.fail_subscription_checkout_intent(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.reserve_subscription_checkout_intent(uuid,uuid,text)
to authenticated,service_role;
grant execute on function public.complete_subscription_checkout_intent(uuid,uuid,text,text),
  public.fail_subscription_checkout_intent(uuid,uuid)
to service_role;
