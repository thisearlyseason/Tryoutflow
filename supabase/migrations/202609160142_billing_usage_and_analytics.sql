-- Product usage limits are centralized and initially unlimited. No new restrictive business rule is invented.
do $$ declare source text; begin
 select pg_get_functiondef('private.effective_billing_access(uuid,uuid)'::regprocedure) into source;
 source:=replace(source,$old$'limits',jsonb_build_object('active_tryouts',null,'athletes_per_tryout',null,'evaluators_per_tryout',null,'custom_templates',null)$old$,
 $new$'limits',(select jsonb_object_agg(k,case when not exists(select 1 from grants) or exists(select 1 from grants where limits->k='null'::jsonb or not limits?k) then 'null'::jsonb else to_jsonb((select max((limits->>k)::integer) from grants)) end) from unnest(array['active_tryouts','athletes_per_tryout','evaluators_per_tryout','custom_templates']) k)$new$);
 execute source;
end $$;
create function private.check_billing_usage() returns trigger language plpgsql security definer set search_path='' as $$
declare maximum integer; used bigint; scope uuid; key text:=TG_ARGV[0];
begin
 perform 1 from public.organizations where id=new.organization_id for update;
 if TG_TABLE_NAME<>'tryouts' then scope:=new.tryout_id; end if;
 maximum:=(private.effective_billing_access(new.organization_id,scope)->'limits'->>key)::integer;
 if maximum is null then return new; end if;
 if key='active_tryouts' then
  if new.status not in ('draft','published') then return new; end if;
  select count(*) into used from public.tryouts where organization_id=new.organization_id and status in ('draft','published') and id<>new.id;
 elsif key='athletes_per_tryout' then
  select count(*) into used from public.tryout_registrations where organization_id=new.organization_id and tryout_id=new.tryout_id and id<>new.id;
 elsif key='evaluators_per_tryout' then
  if new.role<>'evaluator' or new.revoked_at is not null then return new; end if;
  if exists(select 1 from public.tryout_staff_assignments where organization_id=new.organization_id and tryout_id=new.tryout_id and user_id=new.user_id and role='evaluator' and revoked_at is null) then return new; end if;
  select count(distinct user_id) into used from public.tryout_staff_assignments where organization_id=new.organization_id and tryout_id=new.tryout_id and role='evaluator' and revoked_at is null;
 elsif key='custom_templates' then
  select count(*) into used from public.rubrics where organization_id=new.organization_id and id<>new.id;
 else raise exception 'unknown_usage_limit'; end if;
 if used>=maximum then raise exception 'plan_limit_reached' using errcode='42501'; end if;
 return new;
end $$;
create trigger billing_tryout_usage before insert on public.tryouts for each row execute function private.check_billing_usage('active_tryouts');
create trigger billing_athlete_usage before insert on public.tryout_registrations for each row execute function private.check_billing_usage('athletes_per_tryout');
create trigger billing_evaluator_usage before insert on public.tryout_staff_assignments for each row execute function private.check_billing_usage('evaluators_per_tryout');
create trigger billing_template_usage before insert on public.rubrics for each row execute function private.check_billing_usage('custom_templates');
revoke all on function private.check_billing_usage() from public,anon,authenticated,service_role;

create table private.billing_analytics (
 id uuid primary key,organization_id uuid not null references public.organizations(id),event_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(event_name in ('pricing_viewed','checkout_started','checkout_completed','checkout_cancelled','plan_upgraded','plan_downgrade_requested','subscription_cancelled','subscription_restored','upgrade_prompt_viewed','feature_limit_reached'))
);
alter table private.billing_analytics enable row level security;
revoke all on private.billing_analytics from public,anon,authenticated,service_role;
create index billing_analytics_org_time on private.billing_analytics(organization_id,created_at desc);
create function public.record_billing_analytics(p_id uuid,p_organization_id uuid,p_event text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id) then raise exception 'forbidden' using errcode='42501'; end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if (select count(*) from private.billing_analytics where organization_id=p_organization_id and created_at>now()-interval '1 minute')>=60 then return; end if;
 insert into private.billing_analytics(id,organization_id,event_name) values(p_id,p_organization_id,p_event) on conflict(id) do nothing;
end $$;
revoke all on function public.record_billing_analytics(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.record_billing_analytics(uuid,uuid,text) to authenticated;
