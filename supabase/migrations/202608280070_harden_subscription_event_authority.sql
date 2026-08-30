-- Canonical Stripe identifiers, verified subscription lifecycle snapshots, and a deterministic
-- total order for events whose provider-created timestamps are equal.

create function private.is_canonical_stripe_event_id(p_value text) returns boolean
language sql immutable parallel safe strict set search_path='' as $$
  select p_value ~ '^evt_[A-Za-z0-9]{8,200}$'
$$;
create function private.is_canonical_stripe_customer_id(p_value text) returns boolean
language sql immutable parallel safe strict set search_path='' as $$
  select p_value ~ '^cus_[A-Za-z0-9]{8,200}$'
$$;
create function private.is_canonical_stripe_subscription_id(p_value text) returns boolean
language sql immutable parallel safe strict set search_path='' as $$
  select p_value ~ '^sub_[A-Za-z0-9]{8,200}$'
$$;
create function private.is_canonical_stripe_price_id(p_value text) returns boolean
language sql immutable parallel safe strict set search_path='' as $$
  select p_value ~ '^price_[A-Za-z0-9]{8,200}$'
$$;

create function private.stripe_subscription_event_precedence(
  p_plan_key text,p_state text,p_cancel_at_period_end boolean,
  p_cancel_at timestamptz,p_canceled_at timestamptz
) returns smallint language sql immutable parallel safe set search_path='' as $$
  -- Larger values are more restrictive. Unknown price/state fails closed above every verified
  -- state; an observed cancellation outranks past-due and scheduled cancellation. Event ID is
  -- the final C-collated tie-breaker outside this function.
  select case
    when p_plan_key is null or p_plan_key not in('team','club','association')
      or p_state is null or p_state not in('trialing','active','past_due','canceled') then 500
    when p_state='canceled' or p_canceled_at is not null then 400
    when p_state='past_due' then 300
    when p_cancel_at_period_end or p_cancel_at is not null then 250
    when p_state='active' then 200
    else 100
  end::smallint
$$;

alter table public.subscription_accounts
  add column provider_price_id text,
  add column current_period_start timestamptz,
  add column current_period_end timestamptz,
  add column cancel_at_period_end boolean,
  add column cancel_at timestamptz,
  add column canceled_at timestamptz,
  add column trial_end timestamptz,
  add column last_provider_event_precedence smallint;

alter table public.subscription_events
  add column provider_price_id text,
  add column current_period_start timestamptz,
  add column current_period_end timestamptz,
  add column cancel_at_period_end boolean,
  add column cancel_at timestamptz,
  add column canceled_at timestamptz,
  add column trial_end timestamptz,
  add column event_precedence smallint;

update public.subscription_accounts set last_provider_event_precedence=
  private.stripe_subscription_event_precedence(
    plan_key,state,coalesce(cancel_at_period_end,false),cancel_at,canceled_at
  )
where last_provider_event_id is not null;
update public.subscription_events set event_precedence=0;

alter table public.subscription_accounts
  drop constraint subscription_accounts_provider_customer_format,
  drop constraint subscription_accounts_provider_subscription_format,
  add constraint subscription_accounts_provider_customer_format check(
    provider_customer_id is null or private.is_canonical_stripe_customer_id(provider_customer_id)
  ),
  add constraint subscription_accounts_provider_subscription_format check(
    provider_subscription_id is null or private.is_canonical_stripe_subscription_id(provider_subscription_id)
  ),
  add constraint subscription_accounts_provider_price_format check(
    provider_price_id is null or private.is_canonical_stripe_price_id(provider_price_id)
  ),
  add constraint subscription_accounts_event_precedence check(
    (last_provider_event_id is null and last_provider_event_precedence is null)
    or (last_provider_event_id is not null and last_provider_event_precedence between 0 and 500)
  ),
  add constraint subscription_accounts_verified_period check(
    (current_period_start is null and current_period_end is null and cancel_at_period_end is null
      and cancel_at is null and canceled_at is null and trial_end is null)
    or (current_period_start is not null and current_period_end is not null
      and pg_catalog.isfinite(current_period_start) and pg_catalog.isfinite(current_period_end)
      and current_period_start<current_period_end and cancel_at_period_end is not null
      and (cancel_at is null or pg_catalog.isfinite(cancel_at))
      and (canceled_at is null or (pg_catalog.isfinite(canceled_at)
        and canceled_at<=last_provider_event_created_at))
      and (trial_end is null or pg_catalog.isfinite(trial_end)))
  );

alter table public.subscription_events
  drop constraint subscription_events_event_id_format,
  drop constraint subscription_events_customer_format,
  drop constraint subscription_events_subscription_format,
  add constraint subscription_events_event_id_format check(
    private.is_canonical_stripe_event_id(provider_event_id)
  ),
  add constraint subscription_events_customer_format check(
    provider_customer_id is null or private.is_canonical_stripe_customer_id(provider_customer_id)
  ),
  add constraint subscription_events_subscription_format check(
    provider_subscription_id is null or private.is_canonical_stripe_subscription_id(provider_subscription_id)
  ),
  add constraint subscription_events_price_format check(
    provider_price_id is null or private.is_canonical_stripe_price_id(provider_price_id)
  ),
  add constraint subscription_events_precedence_range check(event_precedence between 0 and 500),
  add constraint subscription_events_verified_period check(
    (current_period_start is null and current_period_end is null and cancel_at_period_end is null
      and cancel_at is null and canceled_at is null and trial_end is null)
    or (current_period_start is not null and current_period_end is not null
      and pg_catalog.isfinite(current_period_start) and pg_catalog.isfinite(current_period_end)
      and current_period_start<current_period_end and cancel_at_period_end is not null
      and (cancel_at is null or pg_catalog.isfinite(cancel_at))
      and (canceled_at is null or (pg_catalog.isfinite(canceled_at)
        and canceled_at<=provider_created_at))
      and (trial_end is null or pg_catalog.isfinite(trial_end)))
  );
alter table public.subscription_events alter column event_precedence set not null;

revoke all on function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,uuid,text,text,jsonb,text
) from public,anon,authenticated,service_role;
drop function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,uuid,text,text,jsonb,text
);

create function public.apply_stripe_subscription_event(
  p_event_id text,p_event_type text,p_provider_created_at timestamptz,
  p_customer_id text,p_subscription_id text,p_price_id text,p_organization_id uuid,
  p_plan_key text,p_state text,p_current_period_start timestamptz,
  p_current_period_end timestamptz,p_cancel_at_period_end boolean,
  p_cancel_at timestamptz,p_canceled_at timestamptz,p_trial_end timestamptz,
  p_payload jsonb,p_payload_digest text
) returns text language plpgsql security definer set search_path='' as $$
declare existing public.subscription_events%rowtype; account public.subscription_accounts%rowtype;
  customer_account public.subscription_accounts%rowtype;
  subscription_account public.subscription_accounts%rowtype;
  resolved_organization_id uuid; result text; incoming_precedence smallint;
begin
  if p_event_id is null or p_event_type is null or p_provider_created_at is null
    or p_customer_id is null or p_subscription_id is null or p_payload is null
    or p_payload_digest is null
    or not private.is_canonical_stripe_event_id(p_event_id)
    or p_event_type not in('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')
    or not private.is_canonical_stripe_customer_id(p_customer_id)
    or not private.is_canonical_stripe_subscription_id(p_subscription_id)
    or (p_price_id is not null and not private.is_canonical_stripe_price_id(p_price_id))
    or p_payload_digest !~ '^[0-9a-f]{64}$'
    or not pg_catalog.isfinite(p_provider_created_at)
    or (p_plan_key is not null and p_price_id is null)
    or (p_event_type='customer.subscription.deleted' and p_state is distinct from 'canceled')
    or p_current_period_start is null or p_current_period_end is null
    or not pg_catalog.isfinite(p_current_period_start)
    or not pg_catalog.isfinite(p_current_period_end)
    or p_current_period_start>=p_current_period_end or p_cancel_at_period_end is null
    or (p_cancel_at is not null and not pg_catalog.isfinite(p_cancel_at))
    or (p_canceled_at is not null and (not pg_catalog.isfinite(p_canceled_at)
      or p_canceled_at>p_provider_created_at))
    or (p_trial_end is not null and not pg_catalog.isfinite(p_trial_end))
  then raise exception 'invalid stripe event' using errcode='22023'; end if;

  incoming_precedence:=private.stripe_subscription_event_precedence(
    p_plan_key,p_state,p_cancel_at_period_end,p_cancel_at,p_canceled_at
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stripe-event:'||p_event_id,0));
  select * into existing from public.subscription_events where provider_event_id=p_event_id;
  if found then
    if existing.payload_digest is distinct from p_payload_digest then return 'event_conflict'; end if;
    return 'replayed';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stripe-mapping:'||mapping.provider_id,0)
  ) from unnest(array[p_customer_id,p_subscription_id]) mapping(provider_id)
    order by mapping.provider_id;

  select * into customer_account from public.subscription_accounts
    where provider_customer_id=p_customer_id for update;
  select * into subscription_account from public.subscription_accounts
    where provider_subscription_id=p_subscription_id for update;
  resolved_organization_id:=coalesce(
    p_organization_id,customer_account.organization_id,subscription_account.organization_id
  );

  insert into public.subscription_events(
    provider_event_id,organization_id,event_type,provider_created_at,provider_customer_id,
    provider_subscription_id,provider_price_id,current_period_start,current_period_end,
    cancel_at_period_end,cancel_at,canceled_at,trial_end,event_precedence,payload,payload_digest
  ) values(
    p_event_id,resolved_organization_id,p_event_type,p_provider_created_at,p_customer_id,
    p_subscription_id,p_price_id,p_current_period_start,p_current_period_end,
    p_cancel_at_period_end,p_cancel_at,p_canceled_at,p_trial_end,incoming_precedence,
    p_payload,p_payload_digest
  );

  if customer_account.id is not null and customer_account.organization_id is distinct from resolved_organization_id
    then result:='customer_conflict';
  elsif subscription_account.id is not null and subscription_account.organization_id is distinct from resolved_organization_id
    then result:='subscription_conflict';
  elsif resolved_organization_id is null then result:='unbound';
  else
    select * into account from public.subscription_accounts
      where organization_id=resolved_organization_id for update;
    if not found then result:='unbound';
    elsif customer_account.id is not null and customer_account.id<>account.id then result:='customer_conflict';
    elsif subscription_account.id is not null and subscription_account.id<>account.id then result:='subscription_conflict';
    elsif account.last_provider_event_created_at is not null
      and p_provider_created_at<account.last_provider_event_created_at
      then result:='ignored_out_of_order';
    elsif account.last_provider_event_created_at is not null
      and p_provider_created_at=account.last_provider_event_created_at
      and (incoming_precedence<account.last_provider_event_precedence
        or (incoming_precedence=account.last_provider_event_precedence
          and (p_event_id collate "C")<=(account.last_provider_event_id collate "C")))
      then result:='ignored_out_of_order';
    elsif p_plan_key is null or p_plan_key not in('team','club','association') then
      update public.subscription_accounts set
        provider_customer_id=p_customer_id,provider_subscription_id=p_subscription_id,
        provider_price_id=p_price_id,plan_key=null,state='canceled',entitlement_source='stripe',
        current_period_start=p_current_period_start,current_period_end=p_current_period_end,
        cancel_at_period_end=p_cancel_at_period_end,cancel_at=p_cancel_at,
        canceled_at=p_canceled_at,trial_end=p_trial_end,
        last_provider_event_id=p_event_id,last_provider_event_created_at=p_provider_created_at,
        last_provider_event_precedence=incoming_precedence,
        verified_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
      where id=account.id;
      result:='unknown_price';
    elsif p_state is null or p_state not in('trialing','active','past_due','canceled') then
      update public.subscription_accounts set
        provider_customer_id=p_customer_id,provider_subscription_id=p_subscription_id,
        provider_price_id=p_price_id,plan_key=null,state='canceled',entitlement_source='stripe',
        current_period_start=p_current_period_start,current_period_end=p_current_period_end,
        cancel_at_period_end=p_cancel_at_period_end,cancel_at=p_cancel_at,
        canceled_at=p_canceled_at,trial_end=p_trial_end,
        last_provider_event_id=p_event_id,last_provider_event_created_at=p_provider_created_at,
        last_provider_event_precedence=incoming_precedence,
        verified_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
      where id=account.id;
      result:='invalid_state';
    else
      update public.subscription_accounts set
        provider_customer_id=p_customer_id,provider_subscription_id=p_subscription_id,
        provider_price_id=p_price_id,plan_key=p_plan_key,state=p_state,entitlement_source='stripe',
        current_period_start=p_current_period_start,current_period_end=p_current_period_end,
        cancel_at_period_end=p_cancel_at_period_end,cancel_at=p_cancel_at,
        canceled_at=p_canceled_at,trial_end=p_trial_end,
        last_provider_event_id=p_event_id,last_provider_event_created_at=p_provider_created_at,
        last_provider_event_precedence=incoming_precedence,
        verified_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
      where id=account.id;
      result:='applied';
    end if;
  end if;

  update public.subscription_events set outcome=result,processed_at=clock_timestamp()
    where provider_event_id=p_event_id;
  return result;
end $$;

revoke all on function public.get_owned_subscription_account(uuid)
  from public,anon,authenticated,service_role;
drop function public.get_owned_subscription_account(uuid);
create function public.get_owned_subscription_account(p_organization_id uuid)
returns table(
  organization_id uuid,provider_customer_id text,provider_subscription_id text,
  provider_price_id text,plan_key text,state text,current_period_start timestamptz,
  current_period_end timestamptz,cancel_at_period_end boolean,cancel_at timestamptz,
  canceled_at timestamptz,trial_end timestamptz,verified_at timestamptz,version bigint
) language sql stable security definer set search_path='' as $$
  select account.organization_id,account.provider_customer_id,account.provider_subscription_id,
    account.provider_price_id,account.plan_key,account.state,account.current_period_start,
    account.current_period_end,account.cancel_at_period_end,account.cancel_at,
    account.canceled_at,account.trial_end,account.verified_at,account.version
  from public.subscription_accounts account
  where account.organization_id=p_organization_id
    and public.is_active_organization_member(p_organization_id,array['owner'])
$$;

revoke all on function private.is_canonical_stripe_event_id(text),
  private.is_canonical_stripe_customer_id(text),private.is_canonical_stripe_subscription_id(text),
  private.is_canonical_stripe_price_id(text),
  private.stripe_subscription_event_precedence(text,text,boolean,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,
  timestamptz,timestamptz,timestamptz,jsonb,text
) from public,anon,authenticated,service_role;
grant execute on function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,
  timestamptz,timestamptz,timestamptz,jsonb,text
) to service_role;
revoke all on function public.get_owned_subscription_account(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_owned_subscription_account(uuid) to authenticated,service_role;
