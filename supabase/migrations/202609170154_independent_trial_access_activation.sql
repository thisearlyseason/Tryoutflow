-- No-card trials and feature enforcement can launch before payment providers are activated.
-- The existing enabled switch continues to guard all purchases and provider snapshots.
alter table private.billing_configuration add column access_enabled boolean not null default false;
create function private.billing_access_enabled() returns boolean
language sql stable security definer set search_path='' as $$
 select enabled or access_enabled from private.billing_configuration;
$$;
revoke all on function private.billing_access_enabled() from public,anon,authenticated,service_role;

do $$ declare source text; target record; begin
 for target in select * from (values
 ('private','create_subscription_trial_account'),('private','require_billing_feature'),
 ('private','effective_billing_access'),('private','pro_trial_state'),('public','start_pro_trial'),
 ('private','billing_feature_available'),('private','guard_program_defaults'),
 ('public','publish_tryout'),('public','can_use_talent')
 ) t(schema_name,name) loop
  select pg_get_functiondef(p.oid) into strict source from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname=target.schema_name and p.proname=target.name;
  if position('(select enabled from private.billing_configuration)' in source)=0 then
   raise exception 'access_activation_contract_changed: %',target.name;
  end if;
  execute replace(source,'(select enabled from private.billing_configuration)','private.billing_access_enabled()');
 end loop;
 select pg_get_functiondef('public.get_billing_dashboard(uuid)'::regprocedure) into source;
 if position('return jsonb_build_object(''trial''' in source)=0 then raise exception 'dashboard_activation_contract_changed'; end if;
 execute replace(source,'return jsonb_build_object(''trial''','return jsonb_build_object(''purchasesEnabled'',(select enabled from private.billing_configuration),''trial''');
end $$;
