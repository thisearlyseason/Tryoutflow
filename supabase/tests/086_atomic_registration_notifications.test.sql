begin;
set local search_path=extensions,public;
select no_plan();
select has_function('public','submit_public_registration_with_notification',array['text','jsonb','text','text','text'],'registration and organizer outbox share one transaction');
select function_privs_are('public','submit_public_registration_with_notification',array['text','jsonb','text','text','text'],'service_role',array[]::text[],'legacy atomic wrapper is internal after version-bound promotion');
select function_privs_are('public','submit_public_registration_with_notification',array['text','jsonb','text','text','text'],'authenticated',array[]::text[],'members cannot bypass public route');
select function_privs_are('public','submit_public_registration_with_notification',array['text','jsonb','text','text','text'],'anon',array[]::text[],'anonymous callers cannot invoke transaction');
select function_privs_are('public','submit_public_registration_v2',array['text','jsonb','text','text'],'service_role',array[]::text[],'old transaction cannot bypass organizer outbox');

insert into auth.users(id) values('f1100000-0000-4000-8000-000000000001'),('f1100000-0000-4000-8000-000000000009');
insert into public.organizations(id,name,slug) values('f1100000-0000-4000-8000-000000000002','Atomic Notification Test','atomic-notification-test');
insert into public.organization_members(organization_id,user_id,role,status) values
('f1100000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000001','administrator','active'),
('f1100000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000009','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at)
values('f1100000-0000-4000-8000-000000000003','f1100000-0000-4000-8000-000000000002','Atomic Camp','atomic-notification-camp','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('f1100000-0000-4000-8000-000000000004','f1100000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000003','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('f1100000-0000-4000-8000-000000000005','f1100000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000003','Public Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('f1100000-0000-4000-8000-000000000006','f1100000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000003','f1100000-0000-4000-8000-000000000005',1,'{"fields":[]}','published',clock_timestamp());
insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
values('f1100000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000003','f1100000-0000-4000-8000-000000000006');
update public.tryouts set status='published',published_at=clock_timestamp() where id='f1100000-0000-4000-8000-000000000003';
insert into private.registration_notification_settings(organization_id,tryout_id,notification_email,updated_by_user_id)
values('f1100000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000003','organizer@example.com','f1100000-0000-4000-8000-000000000001');
create temporary table atomic_payload(payload jsonb);
insert into atomic_payload values('{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com","divisionId":"f1100000-0000-4000-8000-000000000004","responses":{}}');

-- Inject a queue storage failure after the inner registration has written rows.
-- The exception is caught by pgTAP; all inner writes must have rolled back.
create function private.test_atomic_notification_failure() returns trigger language plpgsql as $$
begin
  if new.organization_id='f1100000-0000-4000-8000-000000000002'::uuid
    and current_setting('test.atomic_notification_fail',true)='on' then
    raise exception 'simulated_queue_storage_failure' using errcode='XX000';
  end if;
  return new;
end $$;
create trigger test_atomic_notification_failure before insert on public.communication_messages
for each row execute function private.test_atomic_notification_failure();
set local request.jwt.claim.role='service_role';
set local test.atomic_notification_fail='on';
select throws_ok($$select * from public.submit_public_registration_with_notification('atomic-notification-camp',(select payload from atomic_payload),'atomic-registration-key-000001',repeat('a',64),'https://tryout.example')$$,'XX000','simulated_queue_storage_failure','queue write failure aborts registration transaction');
select is((select count(*) from public.tryout_registrations where organization_id='f1100000-0000-4000-8000-000000000002'),0::bigint,'no registration commits without its required notification');
select is((select count(*) from public.athletes where organization_id='f1100000-0000-4000-8000-000000000002'),0::bigint,'failed queue rolls athlete identity back too');
select is((select count(*) from public.registration_confirmation_tokens where organization_id='f1100000-0000-4000-8000-000000000002'),0::bigint,'failed queue rolls confirmation token back');
select is((select count(*) from public.outbox_jobs where organization_id='f1100000-0000-4000-8000-000000000002'),0::bigint,'failed queue leaves no partial job');
set local test.atomic_notification_fail='off';
select throws_ok($$select * from public.submit_public_registration_with_notification('atomic-notification-camp',(select payload from atomic_payload),'atomic-registration-key-000001',repeat('a',64),'http://remote.example')$$,'XX000','organizer_notification_not_persisted','unexpected nonqueued outcome also rolls back registration');
select is((select count(*) from public.tryout_registrations where organization_id='f1100000-0000-4000-8000-000000000002'),0::bigint,'invalid queue outcome leaves retry safe');
create temporary table atomic_first as select * from public.submit_public_registration_with_notification('atomic-notification-camp',(select payload from atomic_payload),'atomic-registration-key-000001',repeat('a',64),'https://tryout.example');
select is((select outcome from atomic_first),'submitted','same submission retries successfully after queue recovery');
select ok((select confirmation_token is not null from atomic_first),'atomic wrapper preserves confirmation token return');
select is((select count(*) from public.tryout_registrations where organization_id='f1100000-0000-4000-8000-000000000002'),1::bigint,'successful transaction persists registration');
select is((select count(*) from public.outbox_jobs where organization_id='f1100000-0000-4000-8000-000000000002'),1::bigint,'successful transaction persists organizer outbox');
create temporary table atomic_replay as select * from public.submit_public_registration_with_notification('atomic-notification-camp',(select payload from atomic_payload),'atomic-registration-key-000001',repeat('a',64),'https://tryout.example');
select is((select outcome from atomic_replay),'replayed','retry keeps registration idempotency contract');
select is((select registration_id from atomic_replay),(select registration_id from atomic_first),'retry returns same registration identity');
select is((select count(*) from public.outbox_jobs where organization_id='f1100000-0000-4000-8000-000000000002'),1::bigint,'retry never duplicates organizer delivery');
update private.registration_notification_settings set notification_email=null where organization_id='f1100000-0000-4000-8000-000000000002';
select is((select outcome from public.submit_public_registration_with_notification('atomic-notification-camp',(select payload||'{"givenName":"Disabled"}' from atomic_payload),'atomic-registration-key-000002',repeat('b',64),'https://tryout.example')),'submitted','disabled notification never prevents registration');
select is((select count(*) from public.outbox_jobs where organization_id='f1100000-0000-4000-8000-000000000002'),1::bigint,'disabled notification creates no additional job');
update private.registration_notification_settings set notification_email='organizer@example.com' where organization_id='f1100000-0000-4000-8000-000000000002';
update public.organization_members set status='disabled' where organization_id='f1100000-0000-4000-8000-000000000002' and user_id='f1100000-0000-4000-8000-000000000001';
select is((select outcome from public.submit_public_registration_with_notification('atomic-notification-camp',(select payload||'{"givenName":"Offboarded"}' from atomic_payload),'atomic-registration-key-000003',repeat('c',64),'https://tryout.example')),'submitted','offboarded notification manager does not prevent registration');
select is((select count(*) from public.outbox_jobs where organization_id='f1100000-0000-4000-8000-000000000002'),1::bigint,'offboarded manager receives no new delivery');
select is((select count(*) from public.outbox_provider_handoffs where organization_id='f1100000-0000-4000-8000-000000000002'),0::bigint,'atomicity tests never attempt provider handoff');
select * from finish();
rollback;
