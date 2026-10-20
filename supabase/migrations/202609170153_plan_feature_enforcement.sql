-- Feature checks live inside RPCs/triggers, including direct authenticated database requests.
create function private.billing_feature_available(p_org uuid,p_tryout uuid,p_feature text)
returns boolean language sql stable security definer set search_path='' as $$
 select not (select enabled from private.billing_configuration)
   or coalesce((private.effective_billing_access(p_org,p_tryout)->'features'->>p_feature)::boolean,false);
$$;
revoke all on function private.billing_feature_available(uuid,uuid,text) from public,anon,authenticated,service_role;

do $$ declare source text; target record; begin
 for target in select * from (values
  ('upsert_organization_logo_service', $check$perform private.require_billing_feature(p_organization_id,null,'custom_branding');$check$),
  ('load_report_summary', $check$perform private.require_billing_feature(p_organization_id,p_tryout_id,case when p_tryout_id is null then 'organization_reporting' else 'export_reports' end);$check$),
  ('load_report_export', $check$if p_tryout_id is null then perform private.require_billing_feature(p_organization_id,null,'organization_reporting'); end if;$check$),
  ('load_ranking_snapshot', $check$if p_athlete_ids is not null then perform private.require_billing_feature(p_organization_id,p_tryout_id,'player_comparison'); end if;$check$),
  ('program_attendance', $check$perform private.require_billing_feature(p_organization_id,null,'organization_reporting');$check$),
  ('calibration_workspace', $check$perform private.require_billing_feature(p_organization_id,null,'advanced_evaluations');$check$),
  ('create_calibration_case', $check$perform private.require_billing_feature(p_organization_id,null,'advanced_evaluations');$check$),
  ('submit_calibration', $check$perform private.require_billing_feature(p_organization_id,null,'advanced_evaluations');$check$)
 ) t(name,guard) loop
  select pg_get_functiondef(p.oid) into strict source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=target.name;
  if position('begin' in lower(source))=0 then raise exception 'unexpected_plan_boundary: %',target.name; end if;
  source:=regexp_replace(source,'\mBEGIN\M','BEGIN '||target.guard,'i');
  execute source;
 end loop;
end $$;

-- Both wizard RPCs and direct rubric mutations go through these guards. Reading retained
-- individual scorecards remains available; building/editing weighted templates is premium.
create function private.guard_plan_feature_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb; scope uuid;
begin
 row_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 scope:=(row_data->>'tryout_id')::uuid;
 if TG_TABLE_NAME='tryout_staff_assignments' then
   if TG_OP='DELETE' or row_data->>'role'<>'evaluator' or row_data->>'revoked_at' is not null then
     return coalesce(new,old);
   end if;
   if TG_OP='UPDATE' and old.role=new.role and old.user_id=new.user_id and old.tryout_id is not distinct from new.tryout_id and old.revoked_at is not distinct from new.revoked_at and old.scope_kind=new.scope_kind and old.division_id is not distinct from new.division_id and old.session_id is not distinct from new.session_id and old.group_id is not distinct from new.group_id and old.expires_at is not distinct from new.expires_at then return new; end if;
 end if;
 perform private.require_billing_feature((row_data->>'organization_id')::uuid,scope,TG_ARGV[0]);
 if TG_TABLE_NAME in ('rubrics','rubric_versions','rubric_categories','session_rubrics') then
   perform private.require_billing_feature((row_data->>'organization_id')::uuid,scope,'advanced_evaluations');
 end if;
 return coalesce(new,old);
end $$;
revoke all on function private.guard_plan_feature_write() from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['rubrics','rubric_versions','rubric_categories','session_rubrics'] loop
  execute format('create trigger billing_feature_write before insert or update or delete on public.%I for each row execute function private.guard_plan_feature_write(''custom_templates'')',t);
 end loop;
end $$;
create trigger billing_feature_write before insert or update on public.tryout_staff_assignments
for each row execute function private.guard_plan_feature_write('unlimited_evaluators');

-- Organization-level reusable language, sport and tag defaults are the program-management
-- capability; core account timezone and membership administration remain operational.
create function private.guard_program_defaults() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if (select enabled from private.billing_configuration) and (new.terminology <> '{"athlete":"Athlete","athletes":"Athletes"}'::jsonb or new.sport_defaults <> '[]'::jsonb or new.tag_defaults <> '[]'::jsonb) then
   raise exception 'entitlement_required' using errcode='42501';
  end if;
  return new;
 end if;
 if (new.terminology,new.sport_defaults,new.tag_defaults) is distinct from (old.terminology,old.sport_defaults,old.tag_defaults) then
  perform private.require_billing_feature(new.id,null,'organization_management');
 end if;
 return new;
end $$;
revoke all on function private.guard_program_defaults() from public,anon,authenticated,service_role;
create trigger billing_program_defaults before insert or update on public.organizations for each row execute function private.guard_program_defaults();

-- Do not delete brand assets on downgrade, but stop serving premium branding.
create or replace function public.read_organization_logo_service(p_organization_slug text)
returns table(content bytea,content_type text,byte_length integer,sha256 text,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select a.content,a.content_type,a.byte_length,a.sha256,a.updated_at
 from public.organizations o join private.organization_brand_assets a on a.organization_id=o.id
 where o.slug=p_organization_slug and private.billing_feature_available(o.id,null,'custom_branding');
$$;
do $$ declare source text; begin
 select pg_get_functiondef('public.get_organization_logo_metadata(uuid)'::regprocedure) into source;
 source:=replace(source,'on asset.organization_id=p_organization_id','on asset.organization_id=p_organization_id and private.billing_feature_available(p_organization_id,null,''custom_branding'')');
 execute source;
 select pg_get_functiondef('public.public_registration_tryout_v2(text)'::regprocedure) into source;
 if position('asset.organization_id is not null' in source)=0 then raise exception 'public_branding_contract_changed'; end if;
 source:=replace(source,'asset.organization_id is not null','(asset.organization_id is not null and private.billing_feature_available(target.organization_id,null,''custom_branding''))');
 execute source;
end $$;

-- A bounded, authorized historical projection instead of an ungated cross-event UI query.
create function public.load_athlete_evaluation_history(p_organization_id uuid,p_athlete_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'forbidden' using errcode='42501'; end if;
 perform private.require_billing_feature(p_organization_id,null,'historical_data');
 return coalesce((select jsonb_agg(card order by created_at desc,id) from (
   select e.id,e.created_at,jsonb_build_object('id',e.id,'tryout_id',e.tryout_id,'tryout_session_id',e.tryout_session_id,
     'state',e.state,'completed_at',e.completed_at,'rubric_version_id',e.rubric_version_id,
     'evaluation_scores',coalesce((select jsonb_agg(jsonb_build_object('value',s.value,'rubric_category_id',s.rubric_category_id,'category_name',c.name) order by c.sort_order,c.id)
       from public.evaluation_scores s join public.rubric_categories c on c.id=s.rubric_category_id and c.organization_id=e.organization_id
       where s.evaluation_id=e.id and s.organization_id=e.organization_id),'[]'::jsonb)) card
   from public.evaluations e join public.tryout_registrations r on r.id=e.tryout_registration_id and r.organization_id=e.organization_id
   where e.organization_id=p_organization_id and r.athlete_id=p_athlete_id
   order by e.created_at desc,e.id limit 200
 ) cards),'[]'::jsonb);
end $$;
revoke all on function public.load_athlete_evaluation_history(uuid,uuid) from public,anon,service_role;
grant execute on function public.load_athlete_evaluation_history(uuid,uuid) to authenticated;
