begin;
select no_plan();
insert into public.organizations(id,name,slug) values ('a1140000-0000-4000-8000-000000000001','Registration Window','window-test-org');
do $$
declare kind text; tid uuid; fid uuid; vid uuid;
begin
 foreach kind in array array['scheduled','open','closed','draft'] loop
  insert into public.tryouts(organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at,starts_at,ends_at)
  values('a1140000-0000-4000-8000-000000000001',kind,'window-test-'||kind,'Hockey','America/Edmonton',
   case when kind='scheduled' then now()+interval '1 day' else now()-interval '2 days' end,
   case when kind='closed' then now()-interval '1 day' else now()+interval '2 days' end,
   now()+interval '30 days',now()+interval '31 days') returning id into tid;
  insert into public.registration_forms(organization_id,tryout_id,name)
  values('a1140000-0000-4000-8000-000000000001',tid,'Form') returning id into fid;
  insert into public.registration_form_versions(organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
  values('a1140000-0000-4000-8000-000000000001',tid,fid,1,'{"fields":[]}','published',now()) returning id into vid;
  insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
  values('a1140000-0000-4000-8000-000000000001',tid,vid);
  if kind<>'draft' then update public.tryouts set status='published',published_at=now() where id=tid; end if;
 end loop;
end $$;
select is((select outcome from public.public_registration_window('window-test-scheduled')),'scheduled','future registration is scheduled, not missing');
select is((select outcome from public.public_registration_window('window-test-closed')),'closed','ended registration is explicitly closed');
select is((select count(*) from public.public_registration_window('window-test-open')),0::bigint,'open registration uses the normal form endpoint');
select is((select count(*) from public.public_registration_tryout_v2('window-test-open')),1::bigint,'registration opens according to initial registration dates despite later event dates');
select is((select count(*) from public.public_registration_tryout_v2('window-test-scheduled')),0::bigint,'scheduled form is not opened early');
select is((select count(*) from public.public_registration_tryout_v2('window-test-closed')),0::bigint,'closed form is not reopened');
select is((select count(*) from public.public_registration_window('window-test-draft')),0::bigint,'draft schedule stays private');
select is((select count(*) from public.public_registration_window('no-such-window')),0::bigint,'unknown slug stays private');
select is((select timezone from public.public_registration_window('window-test-scheduled')),'America/Edmonton','schedule returns the saved timezone');
select ok((select registration_starts_at=now()+interval '1 day' from public.public_registration_window('window-test-scheduled')),'schedule uses registration opening instant');
select ok((select registration_ends_at=now()+interval '2 days' from public.public_registration_window('window-test-scheduled')),'schedule uses registration closing instant');
select ok(not (select to_jsonb(w)?'form_schema' from public.public_registration_window('window-test-scheduled') w),'schedule exposes no form schema');
select ok(has_function_privilege('service_role','public.public_registration_window(text)','EXECUTE'),'server route can load schedule');
select ok(not has_function_privilege('anon','public.public_registration_window(text)','EXECUTE'),'anonymous database RPC denied');
select ok(not has_function_privilege('authenticated','public.public_registration_window(text)','EXECUTE'),'signed-in database RPC denied');
select * from finish();
rollback;
