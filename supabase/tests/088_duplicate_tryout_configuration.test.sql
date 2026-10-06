begin;
set local search_path=extensions,public;
select no_plan();
select has_function('public','duplicate_tryout',array['uuid','uuid'],'atomic duplication RPC exists');
select ok(not has_function_privilege('anon','public.duplicate_tryout(uuid,uuid)','execute'),'anonymous duplication is denied');
insert into auth.users(id) values('f1130000-0000-4000-8000-000000000001'),('f1130000-0000-4000-8000-000000000002'),('f1130000-0000-4000-8000-000000000003');
insert into public.organizations(id,name,slug) values('f1130000-0000-4000-8000-000000000010','Duplicate test','duplicate-test'),('f1130000-0000-4000-8000-000000000011','Other test','duplicate-other');
insert into public.organization_members(organization_id,user_id,role,status) values
('f1130000-0000-4000-8000-000000000010','f1130000-0000-4000-8000-000000000001','owner','active'),
('f1130000-0000-4000-8000-000000000010','f1130000-0000-4000-8000-000000000002','member','active');
set local request.jwt.claim.sub='f1130000-0000-4000-8000-000000000001';
create temporary table duplicate_sources(source_id uuid,copied_id uuid,source_status text);
create function pg_temp.seed_duplicate_source(source_status text) returns uuid language plpgsql as $$
declare org uuid := 'f1130000-0000-4000-8000-000000000010'; t uuid; d uuid; s uuid; f uuid; fv uuid; r uuid; rv uuid;
begin
  insert into public.tryouts(organization_id,name,slug,sport,timezone,description,registration_starts_at,registration_ends_at,starts_at,ends_at,blind_mode,terminology)
  values(org,repeat('A',160),'duplicate-source-'||source_status,'Hockey','America/Edmonton','Description','2026-10-01','2026-11-01','2026-11-02','2026-11-03',true,'{"athlete":"Skater"}') returning id into t;
  insert into public.tryout_divisions(organization_id,tryout_id,name,description,min_age,max_age,sort_order) values(org,t,'U15','Division details',12,15,0) returning id into d;
  insert into public.tryout_positions(organization_id,tryout_id,name,code,is_preset,sort_order) values(org,t,'Forward','F',true,0);
  insert into public.tryout_sessions(organization_id,tryout_id,division_id,name,location,capacity,starts_at,ends_at,sort_order) values(org,t,d,'Skills','Arena',30,'2026-11-02 16:00Z','2026-11-02 18:00Z',0) returning id into s;
  insert into public.session_groups(organization_id,tryout_id,session_id,name,capacity,sort_order) values(org,t,s,'Blue',15,0);
  insert into public.registration_forms(organization_id,tryout_id,name) values(org,t,'Chosen form') returning id into f;
  insert into public.registration_form_versions(organization_id,tryout_id,registration_form_id,version_number,schema)
  values(org,t,f,1,'{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}') returning id into fv;
  insert into public.tryout_registration_form_selections values(org,t,fv,now());
  insert into private.registration_notification_settings(organization_id,tryout_id,notification_email,updated_by_user_id) values(org,t,'organizer@example.com',auth.uid());
  insert into public.rubrics(organization_id,tryout_id,name) values(org,t,'Skills rubric') returning id into r;
  insert into public.rubric_versions(organization_id,tryout_id,rubric_id,version_number) values(org,t,r,1) returning id into rv;
  insert into public.rubric_categories(organization_id,tryout_id,rubric_version_id,name,description,sort_order,weight,scale_min,scale_max,guidance,is_priority)
  values(org,t,rv,'Skating','Speed',0,100,1,5,'Watch technique',true);
  insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) values(org,t,s,rv);
  insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id)
  values(org,'f1130000-0000-4000-8000-000000000002','director','tryout',t,auth.uid());
  if source_status<>'draft' then
    perform * from public.publish_tryout(org,t,0);
    if source_status='finalized' then update public.tryouts set status='finalized',finalized_at=clock_timestamp() where id=t; end if;
  end if;
  return t;
end $$;
insert into duplicate_sources(source_id,source_status) select pg_temp.seed_duplicate_source(status),status from unnest(array['draft','published','finalized']) status;
-- Nonempty operational history proves duplication does not carry people or decisions.
do $$
declare org uuid := 'f1130000-0000-4000-8000-000000000010'; x record; a uuid; registration uuid; evaluation uuid; roster uuid; d uuid; se uuid; fv uuid; rv uuid;
begin
  for x in select source_id from duplicate_sources loop
    select id into d from public.tryout_divisions where tryout_id=x.source_id;
    select id into se from public.tryout_sessions where tryout_id=x.source_id;
    select registration_form_version_id into fv from public.tryout_registration_form_selections where tryout_id=x.source_id;
    select rubric_version_id into rv from public.session_rubrics where tryout_id=x.source_id;
    insert into public.athletes(organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
    values(org,'Existing','Participant','existing','participant','2013-01-01') returning id into a;
    insert into public.tryout_registrations(organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest)
    values(org,x.source_id,a,d,fv,'{"consent":true}',encode(extensions.digest(a::text,'sha256'),'hex')) returning id into registration;
    insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values(org,x.source_id,registration,se);
    evaluation := gen_random_uuid();
    perform private.permit_evaluation_write(evaluation,'save');
    insert into public.evaluations(id,organization_id,tryout_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,division_id)
    values(evaluation,org,x.source_id,registration,se,auth.uid(),rv,d);
    insert into public.roster_versions(organization_id,tryout_id,division_id,revision_number,created_by_user_id) values(org,x.source_id,d,1,auth.uid()) returning id into roster;
    insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at)
    values(org,x.source_id,d,roster,registration,'selected',auth.uid(),clock_timestamp());
  end loop;
end $$;
select is((select count(*) from public.tryout_registrations r join duplicate_sources s on s.source_id=r.tryout_id),3::bigint,'all sources have registrations to exclude');
select is((select count(*) from public.evaluations r join duplicate_sources s on s.source_id=r.tryout_id),3::bigint,'all sources have evaluations to exclude');
select is((select count(*) from public.roster_decisions r join duplicate_sources s on s.source_id=r.tryout_id),3::bigint,'all sources have roster decisions to exclude');
grant select,update on duplicate_sources to authenticated;
set local role authenticated;
update duplicate_sources set copied_id=(select tryout_id from public.duplicate_tryout('f1130000-0000-4000-8000-000000000010',source_id));
reset role;
select is((select count(*) from duplicate_sources where copied_id is not null),3::bigint,'all statuses duplicate successfully');
select is((select count(*) from duplicate_sources s join public.tryouts t on t.id=s.source_id where t.status=s.source_status),3::bigint,'every source status is preserved');
select is((select count(*) from duplicate_sources s join public.tryouts t on t.id=s.copied_id where t.status='draft' and t.published_at is null and t.finalized_at is null and length(t.name)=160 and right(t.name,7)=' (Copy)' and public.is_valid_organization_slug(t.slug)),3::bigint,'copies are drafts with valid bounded names and unique slugs');
select is((select count(*) from duplicate_sources s join public.tryouts t on t.id=s.source_id join public.tryouts c on c.id=s.copied_id where
(to_jsonb(t)-array['id','name','slug','status','published_at','finalized_at','created_at','updated_at','version']) =
(to_jsonb(c)-array['id','name','slug','status','published_at','finalized_at','created_at','updated_at','version'])),3::bigint,'all root configuration metadata is copied');
create function pg_temp.compare_duplicate_children(table_name text,excluded text[]) returns setof text language plpgsql as $$
declare result boolean;
begin
  execute format('select bool_and((select jsonb_agg(to_jsonb(x)-$1 order by (to_jsonb(x)-$1)::text) from public.%I x where x.tryout_id=s.source_id) is not distinct from (select jsonb_agg(to_jsonb(x)-$1 order by (to_jsonb(x)-$1)::text) from public.%I x where x.tryout_id=s.copied_id)) from duplicate_sources s',table_name,table_name) into result using excluded||array['id','tryout_id','created_at','updated_at'];
  return next ok(result,table_name||' definitions are preserved for all source statuses');
  execute format('select not exists(select 1 from public.%I x join duplicate_sources s on x.tryout_id=s.source_id join public.%I y on y.tryout_id=s.copied_id and y.id=x.id)',table_name,table_name) into result;
  return next ok(result,table_name||' IDs are fresh');
end $$;
select * from pg_temp.compare_duplicate_children('tryout_divisions','{}');
select * from pg_temp.compare_duplicate_children('tryout_positions','{}');
select * from pg_temp.compare_duplicate_children('tryout_sessions',array['division_id']);
select * from pg_temp.compare_duplicate_children('session_groups',array['division_id','session_id']);
select * from pg_temp.compare_duplicate_children('registration_forms','{}');
select * from pg_temp.compare_duplicate_children('registration_form_versions',array['registration_form_id','status','published_at']);
select * from pg_temp.compare_duplicate_children('rubrics','{}');
select * from pg_temp.compare_duplicate_children('rubric_versions',array['rubric_id','status','published_at']);
select * from pg_temp.compare_duplicate_children('rubric_categories',array['rubric_version_id']);
select is((select count(*) from public.session_rubrics sr join duplicate_sources x on x.copied_id=sr.tryout_id join public.tryout_sessions s on s.id=sr.session_id and s.tryout_id=x.copied_id join public.rubric_versions r on r.id=sr.rubric_version_id and r.tryout_id=x.copied_id and r.status='draft'),3::bigint,'session rubric bindings point to new editable versions');
select is((select count(*) from private.registration_notification_settings n join duplicate_sources x on x.copied_id=n.tryout_id where notification_email='organizer@example.com'),3::bigint,'private destinations are copied');
select is((select count(*) from public.tryout_staff_assignments a join duplicate_sources x on x.copied_id=a.tryout_id),0::bigint,'source staff assignments are not copied');
select ok(not exists(select 1 from public.tryout_registrations r join duplicate_sources x on x.copied_id=r.tryout_id),'no registrations are copied');
select ok(not exists(select 1 from public.evaluations e join duplicate_sources x on x.copied_id=e.tryout_id),'no evaluations are copied');
select ok(not exists(select 1 from public.roster_versions r join duplicate_sources x on x.copied_id=r.tryout_id),'no roster decisions are copied');
set local role authenticated;
set local request.jwt.claim.sub='f1130000-0000-4000-8000-000000000003';
select throws_ok($$select public.duplicate_tryout('f1130000-0000-4000-8000-000000000010',(select source_id from duplicate_sources limit 1))$$,'42501',null,'outsider cannot duplicate');
set local request.jwt.claim.sub='f1130000-0000-4000-8000-000000000001';
select throws_ok($$select public.duplicate_tryout('f1130000-0000-4000-8000-000000000011',(select source_id from duplicate_sources limit 1))$$,'42501',null,'cross organization source cannot be duplicated');
set local request.jwt.claim.sub='f1130000-0000-4000-8000-000000000002';
update duplicate_sources set copied_id=(select tryout_id from public.duplicate_tryout('f1130000-0000-4000-8000-000000000010',source_id)) where source_status='finalized';
select ok(public.can_manage_tryout_root('f1130000-0000-4000-8000-000000000010',(select copied_id from duplicate_sources where source_status='finalized')),'delegated organizer can immediately edit their new copy');
reset role;
-- Inject a late-stage failure: the whole statement, including the root, must roll back.
create function pg_temp.reject_duplicate_audit() returns trigger language plpgsql as $$ begin if new.action='tryout.duplicated' then raise exception 'forced clone failure'; end if; return new; end $$;
create trigger test_reject_duplicate_audit before insert on public.audit_logs for each row execute function pg_temp.reject_duplicate_audit();
create temporary table duplicate_before as select count(*) as n from public.tryouts;
set local role authenticated;
set local request.jwt.claim.sub='f1130000-0000-4000-8000-000000000001';
select throws_ok($$select public.duplicate_tryout('f1130000-0000-4000-8000-000000000010',(select source_id from duplicate_sources limit 1))$$,'P0001','forced clone failure','late clone failure is explicit');
reset role;
select is((select count(*) from public.tryouts),(select n from duplicate_before),'failed duplication leaves no incomplete root');
select * from finish();
rollback;
