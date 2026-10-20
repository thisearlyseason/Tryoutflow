create table public.platform_administrators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  status text not null default 'active',
  granted_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  constraint platform_administrators_status_check check(status in('active','disabled')),
  constraint platform_administrators_disabled_shape_check check(
    (status='active' and disabled_at is null) or (status='disabled' and disabled_at is not null)
  )
);

alter table public.platform_administrators enable row level security;

revoke all privileges on table public.platform_administrators from public,anon,authenticated,service_role;

alter table public.platform_support_elevations
  add constraint platform_support_elevations_reason_bound_check
  check(char_length(trim(reason)) between 10 and 500) not valid,
  add constraint platform_support_elevations_duration_bound_check
  check(expires_at>=created_at+interval '5 minutes' and expires_at<=created_at+interval '4 hours') not valid;

create function public.is_active_platform_administrator()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select auth.uid() is not null and exists(
    select 1 from public.platform_administrators administrator
    where administrator.user_id=auth.uid() and administrator.status='active'
  );
$$;

create or replace function public.has_active_platform_support_elevation(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.is_active_platform_administrator() and exists(
    select 1 from public.platform_support_elevations elevation
    where elevation.organization_id=target_organization_id
      and elevation.support_user_id=auth.uid()
      and elevation.revoked_at is null
      and elevation.expires_at>clock_timestamp()
  );
$$;

create function public.public_health_check()
returns table(status text)
language sql
stable
set search_path=''
as $$
  select 'ok'::text;
$$;

create function public.platform_health()
returns table(
  database_status text,
  failed_jobs bigint,
  webhook_failures bigint,
  communication_failures bigint,
  integration_failures bigint,
  synchronization_problems bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not public.is_active_platform_administrator() then
    raise exception 'platform authorization required' using errcode='42501';
  end if;
  return query
  select
    'ok'::text,
    (select count(*) from public.outbox_jobs job where job.status in('dead_letter','needs_attention'))
      +(select count(*) from public.integration_outbox_jobs job where job.status in('dead_letter','needs_attention')),
    (select count(*) from public.subscription_events event
      where event.outcome in('unknown_price','unbound','customer_conflict','subscription_conflict','invalid_state','event_conflict')),
    (select count(*) from public.outbox_jobs job where job.status in('dead_letter','needs_attention')),
    (select count(*) from public.integration_sync_jobs job where job.state in('failed','needs_attention')),
    (select count(*) from public.integration_sync_items item where item.state in('failed','requires_review'));
end;
$$;

create function public.platform_list_organizations(p_limit integer default 50)
returns table(
  organization_id uuid,
  organization_name text,
  organization_slug text,
  organization_status text,
  organization_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not public.is_active_platform_administrator() then
    raise exception 'platform authorization required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid platform page size' using errcode='22023';
  end if;
  return query
  select organization.id,organization.name,organization.slug,organization.status,organization.created_at
  from public.organizations organization
  order by organization.created_at desc,organization.id desc
  limit p_limit;
end;
$$;

create function public.platform_list_subscriptions(p_limit integer default 50)
returns table(
  organization_id uuid,
  organization_name text,
  organization_slug text,
  plan_key text,
  subscription_state text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  trial_end timestamptz,
  verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not public.is_active_platform_administrator() then
    raise exception 'platform authorization required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid platform page size' using errcode='22023';
  end if;
  return query
  select organization.id,organization.name,organization.slug,account.plan_key,account.state,
    account.current_period_end,account.cancel_at_period_end,account.trial_end,account.verified_at
  from public.subscription_accounts account
  join public.organizations organization on organization.id=account.organization_id
  order by account.updated_at desc,organization.id desc
  limit p_limit;
end;
$$;

create function public.platform_list_audit_events(p_limit integer default 50)
returns table(
  audit_id uuid,
  organization_id uuid,
  organization_slug text,
  actor_user_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not public.is_active_platform_administrator() then
    raise exception 'platform authorization required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid platform page size' using errcode='22023';
  end if;
  return query
  select audit.id,audit.organization_id,organization.slug,audit.actor_user_id,audit.action,
    audit.entity_type,audit.entity_id,audit.occurred_at
  from public.audit_logs audit
  join public.organizations organization on organization.id=audit.organization_id
  order by audit.occurred_at desc,audit.id desc
  limit p_limit;
end;
$$;

create function public.platform_list_support_elevations(p_limit integer default 50)
returns table(
  elevation_id uuid,
  organization_id uuid,
  organization_slug text,
  support_user_id uuid,
  reason text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not public.is_active_platform_administrator() then
    raise exception 'platform authorization required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid platform page size' using errcode='22023';
  end if;
  return query
  select elevation.id,elevation.organization_id,organization.slug,elevation.support_user_id,
    elevation.reason,elevation.expires_at,elevation.revoked_at,elevation.created_at
  from public.platform_support_elevations elevation
  join public.organizations organization on organization.id=elevation.organization_id
  order by elevation.created_at desc,elevation.id desc
  limit p_limit;
end;
$$;

create function public.begin_support_elevation(
  p_organization_id uuid,
  p_reason text,
  p_expires_at timestamptz
)
returns table(outcome text,elevation_id uuid,expires_at timestamptz)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_reason text:=trim(p_reason);
  v_elevation_id uuid:=gen_random_uuid();
  v_audit_id uuid:=gen_random_uuid();
begin
  if not public.is_active_platform_administrator() then
    return query select 'forbidden'::text,null::uuid,null::timestamptz;
    return;
  end if;
  if p_reason is null or char_length(v_reason) not between 10 and 500 or v_reason ~ '[[:cntrl:]]' then
    return query select 'invalid_reason'::text,null::uuid,null::timestamptz;
    return;
  end if;
  if p_expires_at is null or p_expires_at<v_now+interval '5 minutes' or p_expires_at>v_now+interval '4 hours' then
    return query select 'invalid_expiry'::text,null::uuid,null::timestamptz;
    return;
  end if;
  perform organization.id from public.organizations organization
    where organization.id=p_organization_id for key share;
  if not found then
    return query select 'not_found'::text,null::uuid,null::timestamptz;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||auth.uid()::text,0));
  update public.platform_support_elevations elevation
    set revoked_at=v_now
    where elevation.organization_id=p_organization_id
      and elevation.support_user_id=auth.uid()
      and elevation.revoked_at is null
      and elevation.expires_at<=v_now;
  if exists(
    select 1 from public.platform_support_elevations elevation
    where elevation.organization_id=p_organization_id
      and elevation.support_user_id=auth.uid()
      and elevation.revoked_at is null
      and elevation.expires_at>v_now
  ) then
    return query select 'conflict'::text,null::uuid,null::timestamptz;
    return;
  end if;
  insert into public.audit_logs(id,organization_id,actor_user_id,action,entity_type,entity_id,occurred_at,details)
  values(v_audit_id,p_organization_id,auth.uid(),'platform.support_elevation.started',
    'platform_support_elevation',v_elevation_id,v_now,
    jsonb_build_object('expiresAt',p_expires_at,'supportUserId',auth.uid()));
  insert into public.platform_support_elevations(
    id,organization_id,support_user_id,granted_by_user_id,audit_log_id,reason,expires_at,created_at
  ) values(
    v_elevation_id,p_organization_id,auth.uid(),auth.uid(),v_audit_id,v_reason,p_expires_at,v_now
  );
  return query select 'started'::text,v_elevation_id,p_expires_at;
end;
$$;

revoke all on function public.is_active_platform_administrator() from public,anon,authenticated,service_role;
revoke all on function public.has_active_platform_support_elevation(uuid) from public,anon,authenticated,service_role;
revoke all on function public.public_health_check() from public,anon,authenticated,service_role;
revoke all on function public.platform_health() from public,anon,authenticated,service_role;
revoke all on function public.platform_list_organizations(integer) from public,anon,authenticated,service_role;
revoke all on function public.platform_list_subscriptions(integer) from public,anon,authenticated,service_role;
revoke all on function public.platform_list_audit_events(integer) from public,anon,authenticated,service_role;
revoke all on function public.platform_list_support_elevations(integer) from public,anon,authenticated,service_role;
revoke all on function public.begin_support_elevation(uuid,text,timestamptz) from public,anon,authenticated,service_role;

grant execute on function public.public_health_check() to anon,authenticated;
grant execute on function public.platform_health() to authenticated;
grant execute on function public.platform_list_organizations(integer) to authenticated;
grant execute on function public.platform_list_subscriptions(integer) to authenticated;
grant execute on function public.platform_list_audit_events(integer) to authenticated;
grant execute on function public.platform_list_support_elevations(integer) to authenticated;
grant execute on function public.begin_support_elevation(uuid,text,timestamptz) to authenticated;
