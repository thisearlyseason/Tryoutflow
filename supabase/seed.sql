-- Deterministic synthetic demo data. No password, live contact data, provider
-- credential, or production secret is present in this fixture.
do $seed$
declare
  fixed_time constant timestamptz := '2026-08-28 18:00:00+00';
  registration_id uuid;
  session_id uuid;
  ordinal integer := 0;
begin
  -- First creation exercises the real schema and immutable domain triggers.
  -- The convergence section below runs on every replay.
  if not exists(select 1 from public.organizations where id='29000000-0000-4000-8000-000000000001') then

  insert into auth.users(id,aud,role,email,email_confirmed_at,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000011','authenticated','authenticated','owner@badlands.example.test',fixed_time,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000012','authenticated','authenticated','director@badlands.example.test',fixed_time,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000013','authenticated','authenticated','evaluator-one@badlands.example.test',fixed_time,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000014','authenticated','authenticated','evaluator-two@badlands.example.test',fixed_time,fixed_time,fixed_time);
  insert into public.profiles(id,display_name,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000011','Synthetic Owner',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000012','Synthetic Director',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000013','Synthetic Evaluator One',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000014','Synthetic Evaluator Two',fixed_time,fixed_time);
  insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000001','Badlands Hockey Academy','badlands-hockey-academy','America/Edmonton',
    '{"athlete":"Player","athletes":"Players"}','["Hockey"]','["Prospect","Goalie"]',fixed_time,fixed_time);
  insert into public.organization_members(id,organization_id,user_id,role,status,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000021','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000011','owner','active',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000022','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000012','member','active',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000023','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000013','member','active',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000024','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000014','member','active',fixed_time,fixed_time);

  insert into public.seasons(id,organization_id,name,starts_on,ends_on,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000031','29000000-0000-4000-8000-000000000001','2026-27','2026-08-01','2027-04-30',fixed_time,fixed_time);
  insert into public.tryouts(id,organization_id,season_id,name,slug,sport,timezone,description,
    registration_starts_at,registration_ends_at,starts_at,ends_at,status,published_at,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000031',
    'U15 Fall Evaluations','badlands-u15-fall-2026','Hockey','America/Edmonton','Synthetic edge-case demo tryout.',
    '2026-08-20 00:00:00+00','2026-09-20 00:00:00+00','2026-09-21 16:00:00+00','2026-09-22 22:00:00+00',
    'draft',null,fixed_time,fixed_time);
  insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','U15',0,fixed_time,fixed_time);
  insert into public.tryout_positions(id,organization_id,tryout_id,name,code,is_preset,sort_order,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000034','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','Forward','F',true,0,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000035','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','Defense','D',true,1,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000036','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','Goaltender','G',true,2,fixed_time,fixed_time);
  insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,location,capacity,starts_at,ends_at,sort_order,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000037','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','Skills and skating','Synthetic Rink A',40,'2026-09-21 16:00:00+00','2026-09-21 18:00:00+00',0,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000038','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','Scrimmage','Synthetic Rink B',40,'2026-09-22 16:00:00+00','2026-09-22 18:00:00+00',1,fixed_time,fixed_time);
  insert into public.tryout_staff_assignments(id,organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000041','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000012','director','tryout','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000011',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000042','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000013','evaluator','tryout','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000011',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000043','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000014','evaluator','tryout','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000011',fixed_time,fixed_time);

  insert into public.registration_forms(id,organization_id,tryout_id,name,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000051','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','Badlands registration',fixed_time,fixed_time);
  insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000052','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000051',1,'{"fields":[]}','published','2026-08-28 18:01:00+00',fixed_time,fixed_time);
  insert into public.rubrics(id,organization_id,tryout_id,name,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000053','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','U15 balanced rubric',fixed_time,fixed_time);
  insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number,status,published_at,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000053',1,'draft',null,fixed_time,fixed_time);
  insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max,is_priority,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000055','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000054','Skating',0,90,1,5,true,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000056','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000054','Game sense',1,10,1,10,false,fixed_time,fixed_time);
  insert into public.session_rubrics(id,organization_id,tryout_id,session_id,rubric_version_id,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000057','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000037','29000000-0000-4000-8000-000000000054',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000058','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000038','29000000-0000-4000-8000-000000000054',fixed_time,fixed_time);
  update public.rubric_versions set status='published',published_at='2026-08-28 18:02:00+00',updated_at='2026-08-28 18:02:00+00'
  where id='29000000-0000-4000-8000-000000000054';

  insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000061','29000000-0000-4000-8000-000000000001','Avery','Synthetic','avery','synthetic','2012-01-01',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000062','29000000-0000-4000-8000-000000000001','Blake','Synthetic','blake','synthetic','2012-02-02',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000063','29000000-0000-4000-8000-000000000001','Casey','Synthetic','casey','synthetic','2012-03-03',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000064','29000000-0000-4000-8000-000000000001','Dakota','Synthetic','dakota','synthetic','2012-04-04',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000065','29000000-0000-4000-8000-000000000001','=Edge','Synthetic','edge','synthetic','2012-05-05',fixed_time,fixed_time);
  insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,position_id,registration_form_version_id,responses,source,status,submission_key_digest,submission_digest,submission_digest_version,created_at,updated_at)
  select id,'29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032',athlete_id,'29000000-0000-4000-8000-000000000033',position_id,'29000000-0000-4000-8000-000000000052','{}','staff','submitted',key_digest,payload_digest,2,fixed_time,fixed_time
  from (values
    ('29000000-0000-4000-8000-000000000071'::uuid,'29000000-0000-4000-8000-000000000061'::uuid,'29000000-0000-4000-8000-000000000034'::uuid,repeat('1',64),repeat('a',64)),
    ('29000000-0000-4000-8000-000000000072','29000000-0000-4000-8000-000000000062','29000000-0000-4000-8000-000000000035',repeat('2',64),repeat('b',64)),
    ('29000000-0000-4000-8000-000000000073','29000000-0000-4000-8000-000000000063','29000000-0000-4000-8000-000000000036',repeat('3',64),repeat('c',64)),
    ('29000000-0000-4000-8000-000000000074','29000000-0000-4000-8000-000000000064','29000000-0000-4000-8000-000000000034',repeat('4',64),repeat('d',64)),
    ('29000000-0000-4000-8000-000000000075','29000000-0000-4000-8000-000000000065','29000000-0000-4000-8000-000000000035',repeat('5',64),repeat('e',64))
  ) registration(id,athlete_id,position_id,key_digest,payload_digest);

  foreach registration_id in array array['29000000-0000-4000-8000-000000000071'::uuid,'29000000-0000-4000-8000-000000000072','29000000-0000-4000-8000-000000000073','29000000-0000-4000-8000-000000000074','29000000-0000-4000-8000-000000000075'] loop
    foreach session_id in array array['29000000-0000-4000-8000-000000000037'::uuid,'29000000-0000-4000-8000-000000000038'] loop
      ordinal:=ordinal+1;
      insert into public.session_enrollments(id,organization_id,tryout_id,registration_id,session_id,created_at,updated_at)
      values(format('29000000-0000-4000-8000-%s',lpad((80+ordinal)::text,12,'0'))::uuid,'29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032',registration_id,session_id,fixed_time,fixed_time);
    end loop;
  end loop;
  insert into public.tryout_numbers(id,organization_id,tryout_id,registration_id,division_id,scope_kind,number,assigned_by_user_id,assigned_at)
  select format('29000000-0000-4000-8000-%s',lpad((100+ordinality)::text,12,'0'))::uuid,'29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032',id,'29000000-0000-4000-8000-000000000033','division',(10+ordinality)::integer,'29000000-0000-4000-8000-000000000012',fixed_time
  from unnest(array['29000000-0000-4000-8000-000000000071'::uuid,'29000000-0000-4000-8000-000000000072','29000000-0000-4000-8000-000000000073','29000000-0000-4000-8000-000000000074','29000000-0000-4000-8000-000000000075']) with ordinality registrations(id,ordinality);

  update public.tryouts set status='published',published_at='2026-08-28 18:05:00+00',updated_at='2026-08-28 18:05:00+00'
  where id='29000000-0000-4000-8000-000000000032';

  -- Exact tie: evaluations 121 and 122 have the same complete score vector.
  perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000121','save');
  insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000121','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000071','29000000-0000-4000-8000-000000000037','29000000-0000-4000-8000-000000000013','29000000-0000-4000-8000-000000000054','draft',1,fixed_time,fixed_time);
  insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000131','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000121','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000055',5,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000132','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000121','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000056',2,fixed_time,fixed_time);
  insert into public.evaluation_notes(id,organization_id,evaluation_id,evaluator_user_id,note,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000141','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000121','29000000-0000-4000-8000-000000000013','Synthetic private note that must never appear in reports.',fixed_time,fixed_time);
  perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000121','complete');
  update public.evaluations set state='completed',version=2,completed_at='2026-08-28 18:20:00+00',updated_at='2026-08-28 18:20:00+00' where id='29000000-0000-4000-8000-000000000121';
  delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='29000000-0000-4000-8000-000000000121';

  perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000122','save');
  insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000122','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000072','29000000-0000-4000-8000-000000000037','29000000-0000-4000-8000-000000000014','29000000-0000-4000-8000-000000000054','draft',1,fixed_time,fixed_time);
  insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000133','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000122','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000055',5,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000134','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000122','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000056',2,fixed_time,fixed_time);
  perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000122','complete');
  update public.evaluations set state='completed',version=2,completed_at='2026-08-28 18:21:00+00',updated_at='2026-08-28 18:21:00+00' where id='29000000-0000-4000-8000-000000000122';
  delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='29000000-0000-4000-8000-000000000122';

  -- One genuine incomplete evaluation in the second session.
  perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000123','save');
  insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000123','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000073','29000000-0000-4000-8000-000000000038','29000000-0000-4000-8000-000000000013','29000000-0000-4000-8000-000000000054','draft',1,fixed_time,fixed_time);
  insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000135','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000123','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000055',5,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000136','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000123','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000056',3,fixed_time,fixed_time);
  delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='29000000-0000-4000-8000-000000000123';

  insert into public.tryout_teams(id,organization_id,tryout_id,division_id,name,sort_order,target_size,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000151','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','Badlands Blue',0,18,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000152','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','Badlands Gold',1,18,fixed_time,fixed_time);
  insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,created_by_user_id,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000153','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033',1,'draft',1,'29000000-0000-4000-8000-000000000012',fixed_time,fixed_time);
  insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at)
  select '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000153',id,status,'29000000-0000-4000-8000-000000000012',fixed_time
  from (values
    ('29000000-0000-4000-8000-000000000071'::uuid,'selected'),
    ('29000000-0000-4000-8000-000000000072'::uuid,'waitlisted'),
    ('29000000-0000-4000-8000-000000000073'::uuid,'released'),
    ('29000000-0000-4000-8000-000000000074'::uuid,'callback'),
    ('29000000-0000-4000-8000-000000000075'::uuid,'selected')) decisions(id,status);
  insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id,assigned_at) values
    ('29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000153','29000000-0000-4000-8000-000000000071','29000000-0000-4000-8000-000000000151','29000000-0000-4000-8000-000000000012',fixed_time),
    ('29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000153','29000000-0000-4000-8000-000000000075','29000000-0000-4000-8000-000000000152','29000000-0000-4000-8000-000000000012',fixed_time);
  perform private.capture_roster_report_snapshot('29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000153','2026-08-28 18:30:00+00');
  update public.roster_versions set state='finalized',version=2,finalized_by_user_id='29000000-0000-4000-8000-000000000012',finalized_at='2026-08-28 18:30:00+00',updated_at='2026-08-28 18:30:00+00' where id='29000000-0000-4000-8000-000000000153';
  insert into public.audit_logs(id,organization_id,actor_user_id,action,entity_type,entity_id,occurred_at)
  values('29000000-0000-4000-8000-000000000154','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000012','roster.finalized','roster_version','29000000-0000-4000-8000-000000000153','2026-08-28 18:30:00+00');
  insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,based_on_roster_version_id,state,version,revision_reason,created_by_user_id,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000155','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033',2,'29000000-0000-4000-8000-000000000153','draft',1,'Synthetic correction draft for demo review.','29000000-0000-4000-8000-000000000012','2026-08-28 18:31:00+00','2026-08-28 18:31:00+00');

  insert into public.integration_connections(id,organization_id,provider_key,display_name,state,mock_data,created_by_user_id,connected_at,last_verified_at,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000161','29000000-0000-4000-8000-000000000001','the-squad','The Squad demo/mock','connected',true,'29000000-0000-4000-8000-000000000011',fixed_time,fixed_time,fixed_time,fixed_time);
  insert into public.integration_sync_jobs(id,organization_id,connection_id,provider_key,business_idempotency_key,request_digest,roster_version_id,roster_version,destination_snapshot,approved_fields,provider_preview_id,state,external_job_id,mock_data,created_by_user_id,completed_at,last_error,created_at,updated_at,approved_projection) values
    ('29000000-0000-4000-8000-000000000162','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000161','the-squad','badlands:success:0001',repeat('6',64),'29000000-0000-4000-8000-000000000153',2,'{"displayLabel":"Synthetic destination","mockData":true}',array['first_name','last_name','team_name'],null,'completed','mock-job-success',true,'29000000-0000-4000-8000-000000000011','2026-08-28 18:40:00+00',null,fixed_time,'2026-08-28 18:40:00+00','[]'),
    ('29000000-0000-4000-8000-000000000163','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000161','the-squad','badlands:failure:0001',repeat('7',64),'29000000-0000-4000-8000-000000000153',2,'{"displayLabel":"Synthetic destination","mockData":true}',array['first_name','last_name','team_name'],null,'failed',null,true,'29000000-0000-4000-8000-000000000011',null,'{"code":"synthetic_failure","retryable":false}',fixed_time,'2026-08-28 18:41:00+00','[]');
  insert into public.tryout_setup_progress(id,organization_id,tryout_id,completed_steps,last_step,updated_at)
  values('29000000-0000-4000-8000-000000000171','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032',array['basics','divisions','sessions','registration','rubrics','review','publish'],'publish',fixed_time);
  end if;

  -- Replay convergence repairs mutable demo facts without bypassing RLS,
  -- immutable snapshot triggers, or integration lifecycle constraints.
  -- A second independent evaluator scores Avery identically. This exercises
  -- the real per-evaluator calculation followed by athlete aggregation.
  if not exists(select 1 from public.evaluations where id='29000000-0000-4000-8000-000000000124') then
    perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000124','save');
    insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version,created_at,updated_at)
    values('29000000-0000-4000-8000-000000000124','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000033','29000000-0000-4000-8000-000000000071','29000000-0000-4000-8000-000000000037','29000000-0000-4000-8000-000000000014','29000000-0000-4000-8000-000000000054','draft',1,fixed_time,fixed_time);
    insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value,created_at,updated_at) values
      ('29000000-0000-4000-8000-000000000137','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000124','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000055',5,fixed_time,fixed_time),
      ('29000000-0000-4000-8000-000000000138','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000124','29000000-0000-4000-8000-000000000054','29000000-0000-4000-8000-000000000056',2,fixed_time,fixed_time);
    perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000124','complete');
    update public.evaluations set state='completed',version=2,completed_at='2026-08-28 18:22:00+00',updated_at='2026-08-28 18:22:00+00'
      where id='29000000-0000-4000-8000-000000000124';
    delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='29000000-0000-4000-8000-000000000124';
  end if;
  update public.athletes set given_name='Avery',family_name='Synthetic',normalized_given_name='avery',normalized_family_name='synthetic'
    where id='29000000-0000-4000-8000-000000000061' and (given_name,family_name,normalized_given_name,normalized_family_name) is distinct from ('Avery','Synthetic','avery','synthetic');
  insert into public.tryout_setup_progress(id,organization_id,tryout_id,completed_steps,last_step,updated_at)
  values('29000000-0000-4000-8000-000000000171','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000032',array['basics','divisions','sessions','registration','rubrics','review','publish'],'publish',fixed_time)
  on conflict(id) do update set completed_steps=excluded.completed_steps,last_step=excluded.last_step
  where tryout_setup_progress.completed_steps is distinct from excluded.completed_steps or tryout_setup_progress.last_step is distinct from excluded.last_step;
  update public.integration_sync_jobs set approved_projection='[]'::jsonb,provider_preview_id=null
    where id in ('29000000-0000-4000-8000-000000000162','29000000-0000-4000-8000-000000000163')
      and (approved_projection<>'[]'::jsonb or provider_preview_id is not null);
  insert into public.integration_sync_items(id,organization_id,sync_job_id,item_key,entity_type,internal_entity_id,operation,state,attempts,external_ref,completed_at,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000181','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000162','athlete:29000000-0000-4000-8000-000000000071','athlete','29000000-0000-4000-8000-000000000071','create','completed',1,'{"externalId":"synthetic-athlete-071","entityType":"athlete"}','2026-08-28 18:40:00+00',fixed_time,'2026-08-28 18:40:00+00')
  on conflict(id) do nothing;
  insert into public.integration_sync_items(id,organization_id,sync_job_id,item_key,entity_type,internal_entity_id,operation,state,attempts,normalized_error,retry_eligible,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000182','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000163','athlete:29000000-0000-4000-8000-000000000072','athlete','29000000-0000-4000-8000-000000000072','create','failed',1,'{"code":"synthetic_failure","retryable":false}',false,fixed_time,'2026-08-28 18:41:00+00')
  on conflict(id) do nothing;
  insert into public.external_entity_mappings(id,organization_id,connection_id,provider_key,entity_type,internal_entity_id,external_id,external_ref,first_sync_job_id,last_sync_job_id,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000183','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000161','the-squad','athlete','29000000-0000-4000-8000-000000000071','synthetic-athlete-071','{"externalId":"synthetic-athlete-071","entityType":"athlete"}','29000000-0000-4000-8000-000000000162','29000000-0000-4000-8000-000000000162',fixed_time,'2026-08-28 18:40:00+00')
  on conflict(id) do nothing;

  -- A pre-084 Badlands database may contain published/finalized rows whose
  -- immutable bytes cannot be repaired safely.  Keep that history intact and
  -- converge this independent, append-only current fixture instead.  Every
  -- id is fixed, every mutable insert is individually idempotent, and no
  -- existing finalized roster, published rubric, evaluation, or user record
  -- is rewritten.
  insert into public.tryouts(id,organization_id,season_id,name,slug,sport,timezone,description,
    registration_starts_at,registration_ends_at,starts_at,ends_at,status,published_at,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000031',
    'U15 Converged Demo','badlands-u15-converged-2026','Hockey','America/Edmonton','Append-only deterministic convergence fixture.',
    '2026-08-20 00:00:00+00','2026-09-20 00:00:00+00','2026-09-21 16:00:00+00','2026-09-22 22:00:00+00',
    'draft',null,fixed_time,fixed_time)
  on conflict(id) do nothing;
  if not exists(select 1 from public.tryout_divisions where id='29000000-0000-4000-8000-000000000202') then
  insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','U15 Converged',0,fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.tryout_positions(id,organization_id,tryout_id,name,code,is_preset,sort_order,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000203','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','Forward','F',false,0,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000204','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','Defence','D',false,1,fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,location,capacity,starts_at,ends_at,sort_order,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000206','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','Converged Skills','Synthetic Rink C',40,'2026-09-21 16:00:00+00','2026-09-21 17:00:00+00',0,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000207','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','Converged Scrimmage','Synthetic Rink D',40,'2026-09-22 16:00:00+00','2026-09-22 17:00:00+00',1,fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.registration_forms(id,organization_id,tryout_id,name,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000210','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','Converged registration',fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000211','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000210',1,'{"fields":[]}','published','2026-08-28 18:01:00+00',fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.rubrics(id,organization_id,tryout_id,name,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000212','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','Converged 90/10 rubric',fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number,status,published_at,created_at,updated_at)
  values('29000000-0000-4000-8000-000000000213','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000212',1,'draft',null,fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max,is_priority,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000214','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000213','Skating',0,90,1,5,true,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000215','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000213','Game sense',1,10,1,10,false,fixed_time,fixed_time)
  on conflict(id) do nothing;
  update public.rubric_versions set status='published',published_at='2026-08-28 18:02:00+00',updated_at='2026-08-28 18:02:00+00'
  where id='29000000-0000-4000-8000-000000000213' and status='draft';
  insert into public.session_rubrics(id,organization_id,tryout_id,session_id,rubric_version_id,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000216','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000206','29000000-0000-4000-8000-000000000213',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000217','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000207','29000000-0000-4000-8000-000000000213',fixed_time,fixed_time)
  on conflict(id) do nothing;
  end if;
  insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000221','29000000-0000-4000-8000-000000000001','Avery','Converged','avery','converged','2012-01-01',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000222','29000000-0000-4000-8000-000000000001','Blake','Converged','blake','converged','2012-02-02',fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,position_id,registration_form_version_id,responses,source,status,submission_key_digest,submission_digest,submission_digest_version,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000231','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000221','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000203','29000000-0000-4000-8000-000000000211','{}','staff','submitted',repeat('8',64),repeat('8',64),2,fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000232','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000222','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000204','29000000-0000-4000-8000-000000000211','{}','staff','submitted',repeat('9',64),repeat('9',64),2,fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.session_enrollments(id,organization_id,tryout_id,registration_id,session_id,created_at,updated_at) values
    ('29000000-0000-4000-8000-000000000241','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000231','29000000-0000-4000-8000-000000000206',fixed_time,fixed_time),
    ('29000000-0000-4000-8000-000000000242','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000232','29000000-0000-4000-8000-000000000207',fixed_time,fixed_time)
  on conflict(id) do nothing;
  insert into public.tryout_numbers(id,organization_id,tryout_id,registration_id,division_id,scope_kind,number,assigned_by_user_id,assigned_at) values
    ('29000000-0000-4000-8000-000000000251','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000231','29000000-0000-4000-8000-000000000202','division',51,'29000000-0000-4000-8000-000000000012',fixed_time),
    ('29000000-0000-4000-8000-000000000252','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000232','29000000-0000-4000-8000-000000000202','division',52,'29000000-0000-4000-8000-000000000012',fixed_time)
  on conflict(id) do nothing;
  update public.tryouts set status='published',published_at='2026-08-28 18:05:00+00',updated_at='2026-08-28 18:05:00+00'
  where id='29000000-0000-4000-8000-000000000201' and status='draft';
  if not exists(select 1 from public.evaluations where id='29000000-0000-4000-8000-000000000261') then
    perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000261','save');
    insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version,created_at,updated_at)
    values('29000000-0000-4000-8000-000000000261','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000231','29000000-0000-4000-8000-000000000206','29000000-0000-4000-8000-000000000013','29000000-0000-4000-8000-000000000213','draft',1,fixed_time,fixed_time);
    insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value,created_at,updated_at) values
      ('29000000-0000-4000-8000-000000000271','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000261','29000000-0000-4000-8000-000000000213','29000000-0000-4000-8000-000000000214',5,fixed_time,fixed_time),
      ('29000000-0000-4000-8000-000000000272','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000261','29000000-0000-4000-8000-000000000213','29000000-0000-4000-8000-000000000215',2,fixed_time,fixed_time);
    perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000261','complete');
    update public.evaluations set state='completed',version=2,completed_at='2026-08-28 18:22:00+00',updated_at='2026-08-28 18:22:00+00' where id='29000000-0000-4000-8000-000000000261';
    delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='29000000-0000-4000-8000-000000000261';
  end if;
  if not exists(select 1 from public.evaluations where id='29000000-0000-4000-8000-000000000262') then
    perform private.permit_evaluation_write('29000000-0000-4000-8000-000000000262','save');
    insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version,created_at,updated_at)
    values('29000000-0000-4000-8000-000000000262','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000232','29000000-0000-4000-8000-000000000207','29000000-0000-4000-8000-000000000014','29000000-0000-4000-8000-000000000213','draft',1,fixed_time,fixed_time);
    insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value,created_at,updated_at) values
      ('29000000-0000-4000-8000-000000000273','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000262','29000000-0000-4000-8000-000000000213','29000000-0000-4000-8000-000000000214',5,fixed_time,fixed_time)
    on conflict(id) do nothing;
    delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='29000000-0000-4000-8000-000000000262';
  end if;
  if not exists(select 1 from public.roster_versions where id='29000000-0000-4000-8000-000000000283') then
    insert into public.tryout_teams(id,organization_id,tryout_id,division_id,name,sort_order,target_size,created_at,updated_at)
    values('29000000-0000-4000-8000-000000000281','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','Converged Blue',0,18,fixed_time,fixed_time);
    insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,created_by_user_id,created_at,updated_at)
    values('29000000-0000-4000-8000-000000000283','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202',1,'draft',1,'29000000-0000-4000-8000-000000000012',fixed_time,fixed_time);
    insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at) values
      ('29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000283','29000000-0000-4000-8000-000000000231','selected','29000000-0000-4000-8000-000000000012',fixed_time),
      ('29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000283','29000000-0000-4000-8000-000000000232','waitlisted','29000000-0000-4000-8000-000000000012',fixed_time);
    insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id,assigned_at)
    values('29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000283','29000000-0000-4000-8000-000000000231','29000000-0000-4000-8000-000000000281','29000000-0000-4000-8000-000000000012',fixed_time);
    perform private.capture_roster_report_snapshot('29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000201','29000000-0000-4000-8000-000000000202','29000000-0000-4000-8000-000000000283','2026-08-28 18:30:00+00');
    update public.roster_versions set state='finalized',version=2,finalized_by_user_id='29000000-0000-4000-8000-000000000012',finalized_at='2026-08-28 18:30:00+00',updated_at='2026-08-28 18:30:00+00' where id='29000000-0000-4000-8000-000000000283';
    insert into public.audit_logs(id,organization_id,actor_user_id,action,entity_type,entity_id,occurred_at)
    values('29000000-0000-4000-8000-000000000284','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000012','roster.finalized','roster_version','29000000-0000-4000-8000-000000000283','2026-08-28 18:30:00+00');
  end if;
end
$seed$;
