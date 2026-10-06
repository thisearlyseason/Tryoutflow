-- Preserve each workflow's existing authorization and validation. Add the entitlement check
-- inside the same security-definer function so direct PostgREST RPC calls cannot bypass it.
do $$
declare target record; source text;
begin
 for target in select * from (values
 ('load_athlete_profile_average','radar_charts'),('load_ranking_snapshot','advanced_rankings'),
 ('load_report_export','export_reports'),('start_performance_export','export_reports'),
 ('download_performance_export','export_reports')) as t(name,feature)
 loop
  select pg_get_functiondef(p.oid) into strict source from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=target.name;
  if position(E'\nbegin' in lower(source))=0 then raise exception 'unexpected_function_body: %',target.name; end if;
  source:=regexp_replace(source,'\mBEGIN\M',format('BEGIN perform private.require_billing_feature(p_organization_id,%s,%L);',
    case when position('p_tryout_id uuid' in source)>0 then 'p_tryout_id' else 'null' end,target.feature),'i');
  execute source;
 end loop;
 select pg_get_functiondef('public.publish_tryout(uuid,uuid,integer)'::regprocedure) into source;
 if position('public.organization_subscription_can_publish(p_organization_id)' in source)=0 then raise exception 'unexpected_publish_contract'; end if;
 source:=replace(source,'public.organization_subscription_can_publish(p_organization_id)',
  'coalesce((private.effective_billing_access(p_organization_id,p_tryout_id)->''features''->>''publish_tryout'')::boolean,false)');
 execute source;
end $$;
-- Scouting authorization stays intact. Existing records remain stored on expiration.
create or replace function public.can_use_talent(p_organization_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((private.effective_billing_access(p_organization_id,null)->'features'->>'advanced_scouting')::boolean,false)
 and public.is_active_organization_member(p_organization_id)
 and (public.is_active_organization_member(p_organization_id,array['owner','administrator']) or exists(
 select 1 from public.scouting_grants where organization_id=p_organization_id and user_id=auth.uid()));
$$;
alter table private.billing_purchase_intents alter column expires_at set default clock_timestamp()+interval '1 hour';
