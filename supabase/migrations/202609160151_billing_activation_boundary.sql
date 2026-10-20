-- Ship schema without changing existing access before the provider configuration is verified.
alter table private.billing_configuration add column enabled boolean not null default false;
create or replace function private.require_billing_feature(p_org uuid,p_tryout uuid,p_feature text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not (select enabled from private.billing_configuration) then return; end if;
 if coalesce((private.effective_billing_access(p_org,p_tryout)->'features'->>p_feature)::boolean,false) is not true
 then raise exception 'entitlement_required' using errcode='42501'; end if;
end $$;
do $$ declare source text; begin
 select pg_get_functiondef('public.publish_tryout(uuid,uuid,integer)'::regprocedure) into source;
 source:=replace(source,'coalesce((private.effective_billing_access(p_organization_id,p_tryout_id)->''features''->>''publish_tryout'')::boolean,false)',
 '(case when (select enabled from private.billing_configuration) then coalesce((private.effective_billing_access(p_organization_id,p_tryout_id)->''features''->>''publish_tryout'')::boolean,false) else public.organization_subscription_can_publish(p_organization_id) end)');
 execute source;
 select pg_get_functiondef('public.can_use_talent(uuid)'::regprocedure) into source;
 source:=replace(source,'coalesce((private.effective_billing_access(p_organization_id,null)->''features''->>''advanced_scouting'')::boolean,false)',
 '(not (select enabled from private.billing_configuration) or coalesce((private.effective_billing_access(p_organization_id,null)->''features''->>''advanced_scouting'')::boolean,false))');
 execute source;
 select pg_get_functiondef('public.reserve_billing_purchase(uuid,uuid,uuid,text,text)'::regprocedure) into source;
 source:=replace(source,' select environment into env from private.billing_configuration;',
 ' if not (select enabled from private.billing_configuration) then raise exception ''billing_not_enabled''; end if; select environment into env from private.billing_configuration;');
 execute source;
 select pg_get_functiondef('public.apply_billing_snapshot(jsonb,jsonb,uuid)'::regprocedure) into source;
 source:=regexp_replace(source,'\mBEGIN\M','BEGIN if not (select enabled from private.billing_configuration) then raise exception ''billing_not_enabled''; end if;','i');
 execute source;
 select pg_get_functiondef('public.billing_provider_context(uuid,uuid)'::regprocedure) into source;
 source:=replace(source,'jsonb_build_object(''environment''','jsonb_build_object(''enabled'',(select enabled from private.billing_configuration),''environment''');
 execute source;
end $$;
