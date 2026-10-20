-- Preserve the organization UUID claimed by verified provider metadata without pretending that
-- stale metadata is a live tenant relationship. Only an organization resolved under lock is
-- stored in the FK-bound organization_id column or allowed to mutate subscription authority.

alter table public.subscription_events add column claimed_organization_id uuid;

-- Existing rows were inserted only after their then-current organization_id was selected by the
-- verified event RPC. Backfill that original claim while the append-only guard is deliberately
-- suspended for this one additive schema migration.
alter table public.subscription_events disable trigger guard_subscription_event_mutation;
update public.subscription_events set claimed_organization_id=organization_id;
alter table public.subscription_events enable trigger guard_subscription_event_mutation;

create index subscription_events_claimed_organization_created_idx
on public.subscription_events(claimed_organization_id,provider_created_at desc)
where claimed_organization_id is not null;

create or replace function public.apply_stripe_subscription_event(
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

  -- Account resolution is intentionally serialized. Besides making cross-mapping results
  -- deterministic, this provides one lock order for the claimed parent, account rows, and unique
  -- provider mappings while organization deletion continues to use the parent-first FK order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stripe-subscription-account-resolution',0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stripe-mapping:'||mapping.provider_id,0)
  ) from unnest(array[p_customer_id,p_subscription_id]) mapping(provider_id)
    order by mapping.provider_id;

  resolved_organization_id:=null;
  if p_organization_id is not null then
    select organization.id into resolved_organization_id
    from public.organizations organization where organization.id=p_organization_id
    for key share;
    if resolved_organization_id is not null then
      perform 1 from public.subscription_accounts
      where organization_id=resolved_organization_id for update;
      if not found then resolved_organization_id:=null; end if;
    end if;
  end if;

  select * into customer_account from public.subscription_accounts
    where provider_customer_id=p_customer_id for update;
  select * into subscription_account from public.subscription_accounts
    where provider_subscription_id=p_subscription_id for update;
  if p_organization_id is null then
    resolved_organization_id:=coalesce(
      customer_account.organization_id,subscription_account.organization_id
    );
  end if;

  insert into public.subscription_events(
    provider_event_id,organization_id,claimed_organization_id,event_type,provider_created_at,
    provider_customer_id,provider_subscription_id,provider_price_id,current_period_start,
    current_period_end,cancel_at_period_end,cancel_at,canceled_at,trial_end,event_precedence,
    payload,payload_digest
  ) values(
    p_event_id,resolved_organization_id,p_organization_id,p_event_type,p_provider_created_at,
    p_customer_id,p_subscription_id,p_price_id,p_current_period_start,p_current_period_end,
    p_cancel_at_period_end,p_cancel_at,p_canceled_at,p_trial_end,incoming_precedence,
    p_payload,p_payload_digest
  );

  -- A supplied but nonexistent claim always fails closed as the same unbound result. Do not reveal
  -- whether its provider IDs happen to map to another tenant, and never use that mapping to mutate.
  if p_organization_id is not null and resolved_organization_id is null then result:='unbound';
  elsif customer_account.id is not null
    and customer_account.organization_id is distinct from resolved_organization_id
    then result:='customer_conflict';
  elsif subscription_account.id is not null
    and subscription_account.organization_id is distinct from resolved_organization_id
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

revoke all on function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,
  timestamptz,timestamptz,timestamptz,jsonb,text
) from public,anon,authenticated,service_role;
grant execute on function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,
  timestamptz,timestamptz,timestamptz,jsonb,text
) to service_role;
