-- Subscription state is authoritative only after it is stored by an internal trial grant or a
-- signature-verified Stripe event. Browser return URLs have no write path to these tables.

create table public.subscription_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider_customer_id text unique,
  provider_subscription_id text unique,
  plan_key text,
  state text not null,
  entitlement_source text not null,
  last_provider_event_id text,
  last_provider_event_created_at timestamptz,
  verified_at timestamptz not null,
  version bigint not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint subscription_accounts_organization_id_id_key unique(organization_id,id),
  constraint subscription_accounts_plan_key check(plan_key is null or plan_key in('trial','team','club','association')),
  constraint subscription_accounts_state check(state in('inactive','trialing','active','past_due','canceled')),
  constraint subscription_accounts_entitlement_source check(entitlement_source in('system_trial','stripe')),
  constraint subscription_accounts_provider_customer_format check(
    provider_customer_id is null or provider_customer_id ~ '^cus_[A-Za-z0-9]{8,200}$'
  ),
  constraint subscription_accounts_provider_subscription_format check(
    provider_subscription_id is null or provider_subscription_id ~ '^sub_[A-Za-z0-9]{8,200}$'
  ),
  constraint subscription_accounts_event_pair check(
    (last_provider_event_id is null and last_provider_event_created_at is null)
    or (last_provider_event_id is not null and last_provider_event_created_at is not null)
  ),
  constraint subscription_accounts_version_range check(version between 0 and 9007199254740991)
);

create index subscription_accounts_customer_lookup_idx
on public.subscription_accounts(provider_customer_id) where provider_customer_id is not null;
create index subscription_accounts_subscription_lookup_idx
on public.subscription_accounts(provider_subscription_id) where provider_subscription_id is not null;

create table public.subscription_events (
  provider_event_id text primary key,
  organization_id uuid references public.organizations(id) on delete restrict,
  event_type text not null,
  provider_created_at timestamptz not null,
  provider_customer_id text,
  provider_subscription_id text,
  payload jsonb not null,
  payload_digest text not null,
  outcome text not null default 'processing',
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  constraint subscription_events_event_id_format check(provider_event_id ~ '^evt_[A-Za-z0-9_]{8,200}$'),
  constraint subscription_events_event_type check(event_type in(
    'customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'
  )),
  constraint subscription_events_customer_format check(
    provider_customer_id is null or provider_customer_id ~ '^cus_[A-Za-z0-9]{8,200}$'
  ),
  constraint subscription_events_subscription_format check(
    provider_subscription_id is null or provider_subscription_id ~ '^sub_[A-Za-z0-9]{8,200}$'
  ),
  constraint subscription_events_digest_format check(payload_digest ~ '^[0-9a-f]{64}$'),
  constraint subscription_events_outcome check(outcome in(
    'processing','applied','replayed','ignored_out_of_order','unknown_price','unbound',
    'customer_conflict','subscription_conflict','invalid_state','event_conflict'
  )),
  constraint subscription_events_processing_consistency check(
    (outcome='processing' and processed_at is null) or (outcome<>'processing' and processed_at is not null)
  )
);

create index subscription_events_organization_created_idx
on public.subscription_events(organization_id,provider_created_at desc)
where organization_id is not null;

create function private.create_subscription_trial_account()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.subscription_accounts(
    organization_id,plan_key,state,entitlement_source,verified_at
  ) values(new.id,'trial','trialing','system_trial',clock_timestamp());
  return new;
end $$;

create trigger create_subscription_trial_account
after insert on public.organizations for each row
execute function private.create_subscription_trial_account();

insert into public.subscription_accounts(
  organization_id,plan_key,state,entitlement_source,verified_at
)
select organization.id,'trial','trialing','system_trial',clock_timestamp()
from public.organizations organization
on conflict(organization_id) do nothing;

create function private.guard_subscription_event_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  -- The verified event RPC may complete its own freshly inserted evidence once. Core evidence is
  -- immutable even during that transition; every later mutation is rejected.
  if tg_op='UPDATE'
    and old.outcome='processing' and new.outcome<>'processing'
    and (to_jsonb(new)-array['outcome','processed_at']) = (to_jsonb(old)-array['outcome','processed_at'])
  then return new; end if;
  raise exception 'subscription event evidence is append-only' using errcode='55000';
end $$;

create trigger guard_subscription_event_mutation
before update or delete on public.subscription_events for each row
execute function private.guard_subscription_event_mutation();

create function private.deny_subscription_event_truncate()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'subscription event evidence cannot be truncated' using errcode='55000';
end $$;
create trigger deny_subscription_event_truncate
before truncate on public.subscription_events for each statement
execute function private.deny_subscription_event_truncate();
alter table public.subscription_events enable always trigger deny_subscription_event_truncate;

create function private.guard_organization_subscription_evidence_delete()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.subscription_events event where event.organization_id=old.id)
  then raise exception 'organization has immutable subscription evidence' using errcode='55000'; end if;
  return old;
end $$;
create trigger guard_organization_subscription_evidence_delete
before delete on public.organizations for each row
execute function private.guard_organization_subscription_evidence_delete();

create function public.organization_subscription_can_publish(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select account.plan_key in('trial','team','club','association')
      and account.state in('trialing','active')
      and account.verified_at is not null
    from public.subscription_accounts account
    where account.organization_id=p_organization_id
  ),false)
$$;

create function public.get_owned_subscription_account(p_organization_id uuid)
returns table(
  organization_id uuid,provider_customer_id text,provider_subscription_id text,
  plan_key text,state text,verified_at timestamptz,version bigint
) language sql stable security definer set search_path='' as $$
  select account.organization_id,account.provider_customer_id,account.provider_subscription_id,
    account.plan_key,account.state,account.verified_at,account.version
  from public.subscription_accounts account
  where account.organization_id=p_organization_id
    and public.is_active_organization_member(p_organization_id,array['owner'])
$$;

create function public.apply_stripe_subscription_event(
  p_event_id text,p_event_type text,p_provider_created_at timestamptz,
  p_customer_id text,p_subscription_id text,p_organization_id uuid,
  p_plan_key text,p_state text,p_payload jsonb,p_payload_digest text
) returns text language plpgsql security definer set search_path='' as $$
declare existing public.subscription_events%rowtype; account public.subscription_accounts%rowtype;
  customer_account public.subscription_accounts%rowtype;
  subscription_account public.subscription_accounts%rowtype;
  resolved_organization_id uuid; result text;
begin
  if p_event_id is null or p_event_type is null or p_provider_created_at is null
    or p_customer_id is null or p_subscription_id is null or p_payload is null
    or p_payload_digest is null
    or p_event_id !~ '^evt_[A-Za-z0-9_]{8,200}$'
    or p_event_type not in('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')
    or p_customer_id !~ '^cus_[A-Za-z0-9]{8,200}$'
    or p_subscription_id !~ '^sub_[A-Za-z0-9]{8,200}$'
    or p_payload_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'invalid stripe event' using errcode='22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stripe-event:'||p_event_id,0));
  select * into existing from public.subscription_events where provider_event_id=p_event_id;
  if found then
    if existing.payload_digest is distinct from p_payload_digest then return 'event_conflict'; end if;
    return 'replayed';
  end if;

  -- Unique indexes reject duplicate mappings, while these deterministic locks turn concurrent
  -- first claims into a stable conflict outcome instead of an unclassified constraint error.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stripe-mapping:'||mapping.provider_id,0)
  ) from unnest(array[p_customer_id,p_subscription_id]) mapping(provider_id)
    order by mapping.provider_id;

  select * into customer_account from public.subscription_accounts
    where provider_customer_id=p_customer_id for update;
  select * into subscription_account from public.subscription_accounts
    where provider_subscription_id=p_subscription_id for update;
  resolved_organization_id:=coalesce(p_organization_id,customer_account.organization_id,subscription_account.organization_id);

  insert into public.subscription_events(
    provider_event_id,organization_id,event_type,provider_created_at,provider_customer_id,
    provider_subscription_id,payload,payload_digest
  ) values(
    p_event_id,resolved_organization_id,p_event_type,p_provider_created_at,p_customer_id,
    p_subscription_id,p_payload,p_payload_digest
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
    elsif (customer_account.id is not null and customer_account.id<>account.id) then result:='customer_conflict';
    elsif (subscription_account.id is not null and subscription_account.id<>account.id) then result:='subscription_conflict';
    elsif account.last_provider_event_created_at is not null
      and p_provider_created_at<account.last_provider_event_created_at
      then result:='ignored_out_of_order';
    elsif account.last_provider_event_created_at is not null
      and p_provider_created_at=account.last_provider_event_created_at
      and p_plan_key in('team','club','association')
      and p_state in('trialing','active')
      then result:='ignored_out_of_order';
    elsif p_plan_key is null or p_plan_key not in('team','club','association') then
      update public.subscription_accounts set
        provider_customer_id=p_customer_id,provider_subscription_id=p_subscription_id,
        plan_key=null,state='canceled',entitlement_source='stripe',
        last_provider_event_id=p_event_id,last_provider_event_created_at=p_provider_created_at,
        verified_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
      where id=account.id;
      result:='unknown_price';
    elsif p_state is null or p_state not in('trialing','active','past_due','canceled') then
      update public.subscription_accounts set
        provider_customer_id=p_customer_id,provider_subscription_id=p_subscription_id,
        plan_key=null,state='canceled',entitlement_source='stripe',
        last_provider_event_id=p_event_id,last_provider_event_created_at=p_provider_created_at,
        verified_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
      where id=account.id;
      result:='invalid_state';
    else
      update public.subscription_accounts set
        provider_customer_id=p_customer_id,provider_subscription_id=p_subscription_id,
        plan_key=p_plan_key,state=p_state,entitlement_source='stripe',
        last_provider_event_id=p_event_id,last_provider_event_created_at=p_provider_created_at,
        verified_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
      where id=account.id;
      result:='applied';
    end if;
  end if;

  update public.subscription_events set outcome=result,processed_at=clock_timestamp()
    where provider_event_id=p_event_id;
  return result;
end $$;

-- Publication is the only existing product boundary whose approved specification explicitly
-- depends on subscription entitlement. Already-published tryouts remain readable and idempotent.
create or replace function public.publish_tryout(
  p_organization_id uuid,p_tryout_id uuid,p_expected_version integer
) returns table(outcome text,public_slug text)
language plpgsql security definer set search_path='' as $$
declare target public.tryouts%rowtype; form_version public.registration_form_versions%rowtype;
  form_exists boolean; validation_blocker text;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id)
    then raise exception 'forbidden' using errcode='42501'; end if;
  select * into target from public.tryouts where organization_id=p_organization_id and id=p_tryout_id for update;
  if not found then return query select 'not_found'::text,null::text; return; end if;
  if target.status='published' then return query select 'already_published'::text,target.slug; return; end if;
  if target.status<>'draft' or target.version<>p_expected_version
    then return query select 'conflict'::text,null::text; return; end if;
  perform 1 from public.subscription_accounts where organization_id=p_organization_id for share;
  if public.organization_subscription_can_publish(p_organization_id) is distinct from true
    then return query select 'subscription_required'::text,null::text; return; end if;
  select version.* into form_version from public.tryout_registration_form_selections selection
  join public.registration_form_versions version on version.organization_id=selection.organization_id
    and version.tryout_id=selection.tryout_id and version.id=selection.registration_form_version_id
  where selection.organization_id=p_organization_id and selection.tryout_id=p_tryout_id
  for update of selection,version;
  form_exists:=found;
  perform 1 from public.rubric_versions where organization_id=p_organization_id and tryout_id=p_tryout_id
    and id in(select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id)
    order by id for update;
  perform 1 from public.rubric_categories where organization_id=p_organization_id and tryout_id=p_tryout_id
    and rubric_version_id in(select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id)
    order by rubric_version_id,id for update;
  select blocker into validation_blocker from public.validate_tryout_for_publish(p_organization_id,p_tryout_id) limit 1;
  if validation_blocker is not null then return query select validation_blocker,null::text; return; end if;
  if not form_exists then return query select 'registration_form_missing'::text,null::text; return; end if;
  update public.registration_form_versions set status='published',published_at=clock_timestamp()
    where id=form_version.id and organization_id=p_organization_id and status='draft';
  update public.rubric_versions set status='published',published_at=clock_timestamp()
    where organization_id=p_organization_id and tryout_id=p_tryout_id and status='draft'
      and id in(select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id);
  update public.tryouts set status='published',published_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_tryout_id and version=p_expected_version;
  if not found then return query select 'conflict'::text,null::text; return; end if;
  insert into public.tryout_publications(organization_id,tryout_id,registration_form_version_id)
    values(p_organization_id,p_tryout_id,form_version.id);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'tryout.published','tryout',p_tryout_id);
  return query select 'published'::text,target.slug;
end $$;

alter table public.subscription_accounts enable row level security;
alter table public.subscription_events enable row level security;
create policy subscription_accounts_owner_read on public.subscription_accounts for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner']));

revoke all on public.subscription_accounts,public.subscription_events from public,anon,authenticated,service_role;
grant select on public.subscription_accounts to authenticated;
revoke all on function private.create_subscription_trial_account(),private.guard_subscription_event_mutation(),
  private.deny_subscription_event_truncate(),private.guard_organization_subscription_evidence_delete()
  from public,anon,authenticated,service_role;
revoke all on function public.organization_subscription_can_publish(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_owned_subscription_account(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_owned_subscription_account(uuid) to authenticated,service_role;
revoke all on function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,uuid,text,text,jsonb,text
) from public,anon,authenticated,service_role;
grant execute on function public.apply_stripe_subscription_event(
  text,text,timestamptz,text,text,uuid,text,text,jsonb,text
) to service_role;
