do $$ declare source text; begin
 select pg_get_functiondef('public.create_rubric_revision(uuid,uuid,uuid)'::regprocedure) into source;
 source:=regexp_replace(source,'\mBEGIN\M',$inject$BEGIN
 perform private.require_billing_feature(p_organization_id,(select tryout_id from public.rubrics where organization_id=p_organization_id and id=p_rubric_id),'custom_templates');$inject$,'i');
 execute source;
 select pg_get_functiondef(p.oid) into strict source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='upsert_organization_logo';
 source:=regexp_replace(source,'\mBEGIN\M',$inject$BEGIN perform private.require_billing_feature(p_organization_id,null,'custom_branding');$inject$,'i');
 execute source;
end $$;
-- Organization-wide scouting/history need an organization subscription; a single license is scoped to its tryout.
update public.billing_products set features=array_remove(array_remove(features,'advanced_scouting'),'historical_data') where key='single_tryout_pro';
