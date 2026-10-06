-- An owner explicitly starts one 72-hour Pro trial. No payment method or provider purchase.
-- Existing accounts are untouched; the existing billing activation switch remains authoritative.
create table private.pro_trials (
  organization_id uuid primary key references public.organizations(id),
  started_by uuid not null unique references auth.users(id),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at = starts_at + interval '72 hours')
);
revoke all on private.pro_trials from public, anon, authenticated, service_role;

create or replace function private.create_subscription_trial_account()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.subscription_accounts(organization_id,plan_key,state,entitlement_source,verified_at)
  values(new.id,'trial',case when (select enabled from private.billing_configuration) then 'inactive' else 'trialing' end,'system_trial',clock_timestamp());
  return new;
end $$;

-- Add the trial to the same resolver used by all feature boundaries, preserving paid grants.
do $$ declare source text; begin
  select pg_get_functiondef('private.effective_billing_access(uuid,uuid)'::regprocedure) into source;
  if position('with grants as (' in source)=0 then raise exception 'trial_resolver_contract_changed'; end if;
  source:=replace(source,'with grants as (',$grant$with grants as (
    select p.tier,p.features,p.limits,'trial'::text source,t.expires_at,0 priority
    from private.pro_trials t join public.billing_products p on p.key='pro_monthly'
    where t.organization_id=p_org and t.starts_at<=now() and t.expires_at>now()
      and (select enabled from private.billing_configuration)
    union all
  $grant$);
  execute source;
end $$;

create function private.pro_trial_state(p_org uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'eligible', (select enabled from private.billing_configuration)
      and public.is_active_organization_member(p_org,array['owner'])
      and not exists(select 1 from private.pro_trials where organization_id=p_org or started_by=auth.uid())
      and exists(select 1 from public.subscription_accounts where organization_id=p_org and state='inactive' and provider_subscription_id is null)
      and not exists(select 1 from public.billing_contracts where organization_id=p_org)
      and private.effective_billing_access(p_org)->>'plan'='free',
    'startsAt',(select starts_at from private.pro_trials where organization_id=p_org),
    'expiresAt',(select expires_at from private.pro_trials where organization_id=p_org));
$$;
revoke all on function private.pro_trial_state(uuid) from public, anon, authenticated, service_role;

create function public.start_pro_trial(p_organization_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare started timestamptz;
begin
  if not public.is_active_organization_member(p_organization_id,array['owner']) then raise exception 'forbidden' using errcode='42501'; end if;
  if not (select enabled from private.billing_configuration) then raise exception 'billing_not_enabled'; end if;
  -- Serialize both the organization and the owner: new workspaces cannot restart the clock.
  perform pg_advisory_xact_lock(hashtextextended('pro_trial:'||auth.uid()::text,0));
  perform 1 from public.organizations where id=p_organization_id for update;
  if exists(select 1 from private.pro_trials where organization_id=p_organization_id) then
    return public.get_billing_dashboard(p_organization_id);
  end if;
  if not (private.pro_trial_state(p_organization_id)->>'eligible')::boolean then raise exception 'trial_unavailable'; end if;
  started:=now();
  insert into private.pro_trials values(p_organization_id,auth.uid(),started,started+interval '72 hours');
  insert into public.billing_audit_log(organization_id,event_type,actor_id,metadata)
    values(p_organization_id,'pro_trial_started',auth.uid(),jsonb_build_object('expiresAt',started+interval '72 hours'));
  return public.get_billing_dashboard(p_organization_id);
end $$;
revoke all on function public.start_pro_trial(uuid) from public, anon, service_role;
grant execute on function public.start_pro_trial(uuid) to authenticated;

do $$ declare source text; begin
  select pg_get_functiondef('public.get_billing_dashboard(uuid)'::regprocedure) into source;
  if position('return jsonb_build_object(''access''' in source)=0 then raise exception 'trial_dashboard_contract_changed'; end if;
  source:=replace(source,'return jsonb_build_object(''access''','return jsonb_build_object(''trial'',private.pro_trial_state(p_organization_id),''access''');
  execute source;
end $$;
