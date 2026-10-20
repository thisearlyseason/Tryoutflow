-- Additive billing ledger. No customer records or legacy payment evidence are removed.
create table private.billing_configuration (
  singleton boolean primary key default true check(singleton),
  environment text not null check(environment in ('sandbox','production'))
);
-- Explicit activation is required per deployment; sandbox receipts never become live receipts.
insert into private.billing_configuration values(true,'sandbox');
create table public.billing_products (
  key text primary key, name text not null, tier text not null check(tier in ('free','pro','organization')),
  kind text not null check(kind in ('subscription','tryout')), interval text check(interval in ('month','year')),
  features text[] not null, limits jsonb not null default '{"active_tryouts":null,"athletes_per_tryout":null,"evaluators_per_tryout":null,"custom_templates":null}'::jsonb
);
insert into public.billing_products(key,name,tier,kind,interval,features)
select p.key,p.name,p.tier,p.kind,p.interval,
  array['create_tryout','basic_evaluations','publish_tryout','advanced_evaluations','radar_charts','player_comparison','advanced_rankings','custom_templates','export_reports','historical_data','advanced_scouting','unlimited_evaluators'] ||
  case when p.tier='organization' then array['organization_management','custom_branding','organization_reporting'] else array[]::text[] end
from (values ('pro_monthly','TryOutFlow Pro','pro','subscription','month'),('pro_annual','TryOutFlow Pro','pro','subscription','year'),
 ('organization_monthly','TryOutFlow Organization','organization','subscription','month'),('organization_annual','TryOutFlow Organization','organization','subscription','year'),
 ('single_tryout_pro','Single Tryout Pro','pro','tryout',null)) p(key,name,tier,kind,interval);
create table public.billing_contracts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), tryout_id uuid,
  purchaser_id uuid not null references auth.users(id), provider text not null check(provider in ('stripe','apple','google')),
  environment text not null check(environment in ('sandbox','production')), provider_contract_id text not null check(length(provider_contract_id) between 1 and 512),
  provider_customer_id text not null check(length(provider_customer_id) between 1 and 512),
  product_key text not null references public.billing_products(key),
  status text not null check(status in ('active','trialing','grace_period','past_due','cancelled','expired','refunded','paused','incomplete')),
  current_period_start timestamptz not null, current_period_end timestamptz, grace_period_end timestamptz,
  cancel_at_period_end boolean not null default false, pending_product_key text references public.billing_products(key), downgrade_effective_at timestamptz,
  observed_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
  unique(provider,environment,provider_contract_id), foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id),
  check(current_period_end is null or current_period_end>current_period_start),
  check((pending_product_key is null)=(downgrade_effective_at is null))
);
create index billing_contracts_organization on public.billing_contracts(organization_id,environment);
create index billing_contracts_customer on public.billing_contracts(provider,provider_customer_id);
create index billing_contracts_renewal on public.billing_contracts(status,current_period_end);
create table public.billing_overrides (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), tryout_id uuid,
 product_key text not null references public.billing_products(key), reason text not null check(length(trim(reason)) between 3 and 500),
 starts_at timestamptz not null, expires_at timestamptz not null, granted_by uuid references auth.users(id), revoked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), check(expires_at>starts_at),
 foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id)
);
create index billing_overrides_organization on public.billing_overrides(organization_id,expires_at);
create table public.billing_events (
 id bigint generated always as identity primary key, provider text not null, provider_event_id text not null,
 organization_id uuid references public.organizations(id), contract_id uuid references public.billing_contracts(id),
 event_type text not null, payload_digest text not null check(payload_digest ~ '^[0-9a-f]{64}$'),
 processing_status text not null check(processing_status in ('applied','ignored','conflict')),
 payload_metadata jsonb not null default '{}'::jsonb check(octet_length(payload_metadata::text)<8192),
 occurred_at timestamptz not null, processed_at timestamptz not null default clock_timestamp(),
 unique(provider,provider_event_id)
);
create index billing_events_organization on public.billing_events(organization_id,occurred_at desc);
create table private.billing_purchase_intents (
 id uuid primary key, organization_id uuid not null references public.organizations(id),tryout_id uuid,
 purchaser_id uuid not null references auth.users(id), product_key text not null references public.billing_products(key),
 provider text not null check(provider in ('stripe','apple','google')), environment text not null check(environment in ('sandbox','production')),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
 contract_id uuid references public.billing_contracts(id), checkout_url text,
 foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id)
);
create index billing_intents_owner on private.billing_purchase_intents(purchaser_id,expires_at);
create table public.billing_audit_log (
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id),
 event_type text not null, actor_id uuid references auth.users(id), metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp()
);
create index billing_audit_organization on public.billing_audit_log(organization_id,created_at desc);
create function private.deny_billing_history_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'billing_history_immutable' using errcode='42501'; end $$;
create trigger billing_events_immutable before update or delete or truncate on public.billing_events for each statement execute function private.deny_billing_history_mutation();
create trigger billing_audit_immutable before update or delete or truncate on public.billing_audit_log for each statement execute function private.deny_billing_history_mutation();
create function private.guard_billing_contract() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' then raise exception 'billing_contract_retained'; end if;
 if (new.organization_id,new.tryout_id,new.purchaser_id,new.provider,new.environment,new.provider_contract_id,new.provider_customer_id)
 is distinct from (old.organization_id,old.tryout_id,old.purchaser_id,old.provider,old.environment,old.provider_contract_id,old.provider_customer_id)
 then raise exception 'purchase_ownership_immutable'; end if; return new;
end $$;
create trigger billing_contract_binding before update or delete on public.billing_contracts for each row execute function private.guard_billing_contract();

-- Internal resolver is also used by existing security-definer workflows. Auth is enforced by each public boundary.
create function private.effective_billing_access(p_org uuid,p_tryout uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 with grants as (
 select p.tier,p.features,p.limits,case when c.tryout_id is null then 'organization_subscription' else 'tryout_purchase' end source,
 case when c.status in ('grace_period','past_due') then greatest(c.grace_period_end,c.current_period_end) else c.current_period_end end expires_at,2 priority
 from public.billing_contracts c join public.billing_products p on p.key=c.product_key
 where c.organization_id=p_org and c.environment=(select environment from private.billing_configuration)
 and (c.tryout_id is null or c.tryout_id=p_tryout) and c.current_period_start<=now()
 and c.status in ('active','trialing','grace_period','past_due','cancelled')
 and ((p.kind='tryout' and c.current_period_end is null) or
 case when c.status in ('grace_period','past_due') then greatest(c.grace_period_end,c.current_period_end) else c.current_period_end end>now())
 union all
 select p.tier,p.features,p.limits,'manual',o.expires_at,3 from public.billing_overrides o join public.billing_products p on p.key=o.product_key
 where o.organization_id=p_org and (o.tryout_id is null or o.tryout_id=p_tryout) and o.revoked_at is null and o.starts_at<=now() and o.expires_at>now()
 union all
 -- Existing unlimited trials and legacy plans keep their existing capabilities until converted.
 select 'organization',p.features,p.limits,'legacy',a.current_period_end,1
 from public.subscription_accounts a join public.billing_products p on p.key='organization_monthly'
 where a.organization_id=p_org and a.state in ('active','trialing') and a.plan_key in ('trial','team','club','association')
 and (a.current_period_end is null or a.current_period_end>now())
 and not exists(select 1 from public.billing_contracts c where c.organization_id=p_org and c.tryout_id is null and c.environment=(select environment from private.billing_configuration))
 ), best as (select * from grants order by case tier when 'organization' then 2 else 1 end desc,priority desc limit 1)
 select jsonb_build_object('organizationId',p_org,'tryoutId',p_tryout,'plan',coalesce((select tier from best),'free'),
 'source',coalesce((select source from best),'free'),'evaluatedAt',now(),'expiresAt',(select expires_at from best),
 'features',(select jsonb_object_agg(f,true) from (select unnest(features) f from grants union select 'create_tryout' union select 'basic_evaluations') fs),
 'limits',jsonb_build_object('active_tryouts',null,'athletes_per_tryout',null,'evaluators_per_tryout',null,'custom_templates',null));
$$;
create function public.get_effective_entitlements(p_organization_id uuid,p_tryout_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_tryout_id is not null and not exists(select 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id) then raise exception 'forbidden' using errcode='42501'; end if;
 return private.effective_billing_access(p_organization_id,p_tryout_id);
end $$;
create function private.require_billing_feature(p_org uuid,p_tryout uuid,p_feature text) returns void
language plpgsql stable security definer set search_path='' as $$
begin if coalesce((private.effective_billing_access(p_org,p_tryout)->'features'->>p_feature)::boolean,false) is not true
 then raise exception 'entitlement_required' using errcode='42501'; end if; end $$;

create function public.reserve_billing_purchase(p_id uuid,p_organization_id uuid,p_tryout_id uuid,p_product_key text,p_provider text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i private.billing_purchase_intents%rowtype; p public.billing_products%rowtype; env text;
begin
 if not public.is_active_organization_member(p_organization_id,array['owner']) then raise exception 'forbidden' using errcode='42501'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 select environment into env from private.billing_configuration;
 select * into p from public.billing_products where key=p_product_key;
 if not found or (p.kind='tryout')<>(p_tryout_id is not null) then raise exception 'invalid_product'; end if;
 select * into i from private.billing_purchase_intents where id=p_id;
 if found then
  if (i.organization_id,i.tryout_id,i.purchaser_id,i.product_key,i.provider,i.environment) is distinct from (p_organization_id,p_tryout_id,auth.uid(),p_product_key,p_provider,env) then raise exception 'intent_conflict'; end if;
  if i.expires_at<=now() then raise exception 'intent_expired'; end if;
  return to_jsonb(i);
 end if;
 if exists(select 1 from private.billing_purchase_intents where organization_id=p_organization_id and expires_at>now() and contract_id is null) then raise exception 'purchase_in_progress'; end if;
 if exists(select 1 from public.billing_contracts c where c.organization_id=p_organization_id and c.environment=env
  and (c.tryout_id is null or c.tryout_id=p_tryout_id) and c.status in ('active','trialing','grace_period','past_due','cancelled','incomplete')
  and (c.current_period_end is null or greatest(c.current_period_end,c.grace_period_end)>now()))
 or exists(select 1 from public.subscription_accounts where organization_id=p_organization_id and provider_subscription_id is not null and state in ('active','trialing','past_due'))
 then raise exception 'already_subscribed'; end if;
 -- A native store customer cannot bind one organization subscription to several organizations.
 if p_provider<>'stripe' and p.kind='subscription' and exists(select 1 from public.billing_contracts where purchaser_id=auth.uid() and provider in ('apple','google') and tryout_id is null and environment=env and status in ('active','trialing','past_due','grace_period','cancelled') and current_period_end>now()) then raise exception 'already_subscribed'; end if;
 insert into private.billing_purchase_intents(id,organization_id,tryout_id,purchaser_id,product_key,provider,environment)
 values(p_id,p_organization_id,p_tryout_id,auth.uid(),p_product_key,p_provider,env) returning * into i;
 insert into public.billing_audit_log(organization_id,event_type,actor_id,metadata) values(p_organization_id,'checkout_started',auth.uid(),jsonb_build_object('product',p_product_key,'provider',p_provider));
 return to_jsonb(i);
end $$;

-- Only trusted adapters submit verified, minimized provider snapshots. The whole receipt and state transition commit together.
create function public.apply_billing_snapshot(p_event jsonb,p_snapshot jsonb,p_intent_id uuid default null) returns text
language plpgsql security definer set search_path='' as $$
declare c public.billing_contracts%rowtype; i private.billing_purchase_intents%rowtype; prior public.billing_events%rowtype;
 provider_name text:=p_snapshot->>'provider'; env text:=p_snapshot->>'environment'; product public.billing_products%rowtype; cid uuid; result text:='applied';
begin
 if env is distinct from (select environment from private.billing_configuration) then return 'environment_mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(provider_name||':'||(p_snapshot->>'provider_contract_id'),0));
 select * into prior from public.billing_events where provider=p_event->>'provider' and provider_event_id=p_event->>'id';
 if found then if prior.payload_digest<>p_event->>'digest' then return 'event_conflict'; end if; return 'replayed'; end if;
 select * into product from public.billing_products where key=p_snapshot->>'product_key';
 if not found then raise exception 'unknown_product'; end if;
 select * into c from public.billing_contracts where provider=provider_name and environment=env and provider_contract_id=p_snapshot->>'provider_contract_id' for update;
 if found then
  if c.purchaser_id::text<>p_snapshot->>'purchaser_id' or c.provider_customer_id<>p_snapshot->>'provider_customer_id' then raise exception 'purchase_ownership_conflict'; end if;
  if c.observed_at>=(p_snapshot->>'observed_at')::timestamptz then result:='ignored'; end if;
 else
  select * into i from private.billing_purchase_intents where id=p_intent_id for update;
  if not found or i.contract_id is not null or i.purchaser_id::text<>p_snapshot->>'purchaser_id' or i.provider<>provider_name or i.environment<>env or i.product_key<>product.key
    or (p_snapshot->>'current_period_start')::timestamptz<i.created_at-interval '5 minutes'
    or (p_snapshot->>'current_period_start')::timestamptz>i.expires_at
  then raise exception 'purchase_attribution_required'; end if;
  c.id:=gen_random_uuid(); c.organization_id:=i.organization_id; c.tryout_id:=i.tryout_id;
 end if;
 if (product.kind='tryout')<>(c.tryout_id is not null) or (product.kind='subscription' and p_snapshot->>'current_period_end' is null) then raise exception 'invalid_scope'; end if;
 if result='applied' then
  insert into public.billing_contracts(id,organization_id,tryout_id,purchaser_id,provider,environment,provider_contract_id,provider_customer_id,product_key,status,current_period_start,current_period_end,grace_period_end,cancel_at_period_end,pending_product_key,downgrade_effective_at,observed_at)
  values(c.id,c.organization_id,c.tryout_id,(p_snapshot->>'purchaser_id')::uuid,provider_name,env,p_snapshot->>'provider_contract_id',p_snapshot->>'provider_customer_id',product.key,p_snapshot->>'status',(p_snapshot->>'current_period_start')::timestamptz,(p_snapshot->>'current_period_end')::timestamptz,(p_snapshot->>'grace_period_end')::timestamptz,coalesce((p_snapshot->>'cancel_at_period_end')::boolean,false),p_snapshot->>'pending_product_key',(p_snapshot->>'downgrade_effective_at')::timestamptz,(p_snapshot->>'observed_at')::timestamptz)
  on conflict(provider,environment,provider_contract_id) do update set product_key=excluded.product_key,status=excluded.status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,grace_period_end=excluded.grace_period_end,cancel_at_period_end=excluded.cancel_at_period_end,pending_product_key=excluded.pending_product_key,downgrade_effective_at=excluded.downgrade_effective_at,observed_at=excluded.observed_at;
  if i.id is not null then update private.billing_purchase_intents set contract_id=c.id where id=i.id; end if;
  insert into public.billing_audit_log(organization_id,event_type,metadata) values(c.organization_id,p_event->>'type',jsonb_build_object('provider',provider_name,'product',product.key,'status',p_snapshot->>'status'));
 end if;
 insert into public.billing_events(provider,provider_event_id,organization_id,contract_id,event_type,payload_digest,processing_status,occurred_at)
 values(p_event->>'provider',p_event->>'id',c.organization_id,c.id,p_event->>'type',p_event->>'digest',result,(p_event->>'occurred_at')::timestamptz);
 return result;
end $$;

create function public.manage_billing_override(p_organization_id uuid,p_product_key text,p_reason text,p_starts_at timestamptz,p_expires_at timestamptz,p_tryout_id uuid default null,p_revoke_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not public.is_active_platform_administrator() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_revoke_id is null then
  insert into public.billing_overrides(organization_id,tryout_id,product_key,reason,starts_at,expires_at,granted_by)
  values(p_organization_id,p_tryout_id,p_product_key,p_reason,p_starts_at,p_expires_at,auth.uid()) returning id into result;
 else
  update public.billing_overrides set revoked_at=clock_timestamp() where id=p_revoke_id and organization_id=p_organization_id and revoked_at is null returning id into result;
  if result is null then raise exception 'override_not_found'; end if;
 end if;
 insert into public.billing_audit_log(organization_id,event_type,actor_id,metadata) values(p_organization_id,case when p_revoke_id is null then 'complimentary_access_granted' else 'complimentary_access_revoked' end,auth.uid(),jsonb_build_object('overrideId',result,'reason',p_reason));
 return result;
end $$;

create function public.get_billing_dashboard(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not (public.is_active_organization_member(p_organization_id,array['owner','administrator']) or public.is_active_platform_administrator()) then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object('access',private.effective_billing_access(p_organization_id),
 'subscriptions',coalesce((select jsonb_agg(to_jsonb(c)-'provider_customer_id'-'provider_contract_id'-'purchaser_id') from public.billing_contracts c where organization_id=p_organization_id and environment=(select environment from private.billing_configuration)),'[]'::jsonb),
 'overrides',coalesce((select jsonb_agg(to_jsonb(o)) from public.billing_overrides o where organization_id=p_organization_id),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(to_jsonb(a)) from (select event_type,created_at,metadata from public.billing_audit_log where organization_id=p_organization_id order by created_at desc limit 50) a),'[]'::jsonb),
 'usage',jsonb_build_object('active_tryouts',(select count(*) from public.tryouts where organization_id=p_organization_id and status in ('draft','published'))));
end $$;

-- RLS is defense in depth. Billing state is never writable by a user JWT, including owners.
alter table public.billing_products enable row level security;
alter table public.billing_contracts enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_overrides enable row level security;
alter table public.billing_audit_log enable row level security;
alter table private.billing_configuration enable row level security;
alter table private.billing_purchase_intents enable row level security;
create policy billing_products_read on public.billing_products for select to authenticated using(true);
create policy billing_contracts_read on public.billing_contracts for select to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy billing_overrides_read on public.billing_overrides for select to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy billing_audit_read on public.billing_audit_log for select to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator']));
revoke all on public.billing_products,public.billing_contracts,public.billing_events,public.billing_overrides,public.billing_audit_log,private.billing_configuration,private.billing_purchase_intents from public,anon,authenticated,service_role;
grant select on public.billing_products,public.billing_contracts,public.billing_overrides,public.billing_audit_log to authenticated;
grant select on public.billing_products,public.billing_contracts,public.billing_events,public.billing_overrides,public.billing_audit_log to service_role;
revoke all on function private.deny_billing_history_mutation(),private.guard_billing_contract(),private.effective_billing_access(uuid,uuid),private.require_billing_feature(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_effective_entitlements(uuid,uuid),public.reserve_billing_purchase(uuid,uuid,uuid,text,text),public.apply_billing_snapshot(jsonb,jsonb,uuid),public.manage_billing_override(uuid,text,text,timestamptz,timestamptz,uuid,uuid),public.get_billing_dashboard(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_effective_entitlements(uuid,uuid),public.reserve_billing_purchase(uuid,uuid,uuid,text,text),public.manage_billing_override(uuid,text,text,timestamptz,timestamptz,uuid,uuid),public.get_billing_dashboard(uuid) to authenticated;
grant execute on function public.apply_billing_snapshot(jsonb,jsonb,uuid) to service_role;

-- Operational context stays server-only; no provider identifiers or purchase intent ownership are accepted from client claims.
create function public.billing_provider_context(p_organization_id uuid default null,p_purchaser_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('environment',(select environment from private.billing_configuration),
 'contracts',coalesce((select jsonb_agg(to_jsonb(c)) from public.billing_contracts c where (p_organization_id is null or c.organization_id=p_organization_id) and (p_purchaser_id is null or c.purchaser_id=p_purchaser_id) and c.environment=(select environment from private.billing_configuration)),'[]'::jsonb),
 'intents',coalesce((select jsonb_agg(to_jsonb(i)) from private.billing_purchase_intents i where (p_organization_id is null or i.organization_id=p_organization_id) and (p_purchaser_id is null or i.purchaser_id=p_purchaser_id) and i.environment=(select environment from private.billing_configuration) and i.created_at>now()-interval '30 days'),'[]'::jsonb));
$$;
revoke all on function public.billing_provider_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.billing_provider_context(uuid,uuid) to service_role;
