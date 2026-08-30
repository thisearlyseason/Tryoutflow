begin;
select plan(52);

select has_function('public','create_decision_message_batch_v2',array[
  'uuid','uuid','uuid','uuid','text','text','text'
], 'the exact confirmation command remains installed');
select ok(has_function_privilege('authenticated',
  'public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text)','execute'),
  'authenticated senders retain the confirmation command');
select ok(has_function_privilege('service_role',
  'public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text)','execute'),
  'the service role reaches the same actor-bound confirmation guard');

insert into auth.users(id,email) values
  ('50000000-0000-4000-8000-000000000001','task23-null-owner@example.com');
insert into public.organizations(id,name,slug) values
  ('50000000-0000-4000-8000-000000000002','Task 23 Null Contract','task23-null-contract');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000001','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
  ('50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000002',
    'Null Contract Tryout','task23-null-contract-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('50000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003','Form');
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at
) values(
  '50000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000005',
  1,'{"fields":[]}','published',clock_timestamp()
);
insert into public.athletes(
  id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
) values(
  '50000000-0000-4000-8000-000000000007','50000000-0000-4000-8000-000000000002',
  'Ava','Smith','ava','smith','2013-01-01'
);
insert into public.guardians(id,organization_id,name,email,normalized_email) values(
  '50000000-0000-4000-8000-000000000008','50000000-0000-4000-8000-000000000002',
  'Private Guardian','task23-null-recipient@example.com','task23-null-recipient@example.com'
);
insert into public.athlete_guardians(
  organization_id,athlete_id,guardian_id,relationship_label,is_primary_contact,communication_permitted
) values(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000007',
  '50000000-0000-4000-8000-000000000008','Guardian',true,true
);
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest
) values(
  '50000000-0000-4000-8000-000000000009','50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000007',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000006',
  '{}',repeat('5',64),repeat('6',64)
);
insert into public.roster_versions(
  id,organization_id,tryout_id,division_id,revision_number,state,version,created_by_user_id
) values(
  '50000000-0000-4000-8000-000000000010','50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004',
  1,'draft',1,'50000000-0000-4000-8000-000000000001'
);
insert into public.roster_decisions(
  organization_id,tryout_id,division_id,roster_version_id,registration_id,status,
  changed_by_user_id,changed_at
) values(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  '50000000-0000-4000-8000-000000000009','selected',
  '50000000-0000-4000-8000-000000000001',clock_timestamp()
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
select public.finalize_roster_version(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  1,'FINALIZE ROSTER'
);

create temporary table task23_null_previews(label text primary key,payload jsonb not null);
insert into task23_null_previews(label,payload)
select 'case-'||series,public.preview_decision_message_batch_v2(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000010',
  'selected','Null-contract preview '||series||'.','builtin:selected',1
) from generate_series(1,8) series;
grant select on task23_null_previews to authenticated,service_role;

create function pg_temp.task23_confirm(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_preview_token text,p_preview_digest text,p_confirmation text
) returns text language plpgsql as $$
declare result text;
begin
  select outcome into result from public.create_decision_message_batch_v2(
    p_organization_id,p_tryout_id,p_division_id,p_roster_version_id,
    p_preview_token,p_preview_digest,p_confirmation
  );
  return result;
exception when others then
  return 'error:'||sqlstate;
end $$;
grant execute on function pg_temp.task23_confirm(uuid,uuid,uuid,uuid,text,text,text)
  to authenticated,service_role;

set local role authenticated;

select is((pg_temp.task23_confirm(
  null,'50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000010',payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null live organization ID is rejected before capability lookup')
from task23_null_previews where label='case-1';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002',null,'50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000010',payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null live tryout ID is rejected before capability lookup')
from task23_null_previews where label='case-2';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',null,
  '50000000-0000-4000-8000-000000000010',payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null live division ID is rejected before capability lookup')
from task23_null_previews where label='case-3';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004',null,payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null live roster ID is rejected before capability lookup')
from task23_null_previews where label='case-4';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  null,payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null live preview token is rejected before hashing')
from task23_null_previews where label='case-5';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',null,'SEND EXACT BATCH'
)),'invalid_input','a null live preview digest is rejected before comparison')
from task23_null_previews where label='case-6';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest',null
)),'invalid_input','a null live confirmation phrase is rejected before locking')
from task23_null_previews where label='case-7';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  'not-a-token',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a malformed live preview token is rejected')
from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken','not-a-digest','SEND EXACT BATCH'
)),'invalid_input','a malformed live preview digest is rejected')
from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest','send exact batch'
)),'invalid_input','a malformed live confirmation phrase is rejected')
from task23_null_previews where label='case-8';

reset role;
select is((select count(*)::text||'|'||
  (select count(*) from public.communication_batches where organization_id='50000000-0000-4000-8000-000000000002')||'|'||
  (select count(*) from public.communication_messages where organization_id='50000000-0000-4000-8000-000000000002')||'|'||
  (select count(*) from public.outbox_jobs where organization_id='50000000-0000-4000-8000-000000000002')||'|'||
  (select count(*) from public.communication_preview_tombstones)
  from public.communication_preview_proofs where organization_id='50000000-0000-4000-8000-000000000002'),
  '8|0|0|0|0','all rejected live calls preserve every proof and create no communication state');

set local role authenticated;
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'queued','a live proof remains usable after the rejected matrix')
from task23_null_previews where label='case-8';

select is((pg_temp.task23_confirm(
  null,'50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000010',payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null consumed organization ID cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002',null,'50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000010',payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null consumed tryout ID cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',null,
  '50000000-0000-4000-8000-000000000010',payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null consumed division ID cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004',null,payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null consumed roster ID cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  null,payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a null consumed preview token cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',null,'SEND EXACT BATCH'
)),'invalid_input','a null consumed preview digest cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest',null
)),'invalid_input','a null consumed confirmation phrase cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  'not-a-token',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a malformed consumed preview token cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken','not-a-digest','SEND EXACT BATCH'
)),'invalid_input','a malformed consumed preview digest cannot replay') from task23_null_previews where label='case-8';
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest','send exact batch'
)),'invalid_input','a malformed consumed phrase cannot replay') from task23_null_previews where label='case-8';

select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000099',true);
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'forbidden','a different actor cannot replay a consumed proof') from task23_null_previews where label='case-8';
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'replayed','the exact consumed proof remains replayable after rejected calls') from task23_null_previews where label='case-8';

reset role;
select is((select
  (select count(*) from public.communication_batches where organization_id='50000000-0000-4000-8000-000000000002')||'|'||
  (select count(*) from public.communication_messages where organization_id='50000000-0000-4000-8000-000000000002')||'|'||
  (select count(*) from public.outbox_jobs where organization_id='50000000-0000-4000-8000-000000000002')||'|'||
  (select count(*) from public.communication_preview_tombstones)),
  '1|1|1|1','rejected consumed calls create no duplicate batch, message, job, or tombstone');

select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','the service role cannot supply a missing actor') from task23_null_previews where label='case-8';
reset role;
select is((pg_temp.task23_confirm(
  '50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010',
  payload->>'previewToken',payload->>'digest','SEND EXACT BATCH'
)),'invalid_input','a direct owner call cannot supply a missing actor') from task23_null_previews where label='case-8';

select set_config('request.jwt.claim.role','',true);
set local role service_role;
select is(public.apply_resend_delivery_event(null,
  '50000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000012',
  'delivered',clock_timestamp()),'invalid_input','a null provider event id is rejected');
select is(public.apply_resend_delivery_event('msg_task23null0001',null,
  '50000000-0000-4000-8000-000000000012','delivered',clock_timestamp()),
  'invalid_input','a null provider message target is rejected');
select is(public.apply_resend_delivery_event('msg_task23null0002',
  '50000000-0000-4000-8000-000000000011',null,'delivered',clock_timestamp()),
  'invalid_input','a null provider message id is rejected');
select is(public.apply_resend_delivery_event('msg_task23null0003',
  '50000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000012',
  null,clock_timestamp()),'invalid_input','a null provider event kind is rejected');
select is(public.apply_resend_delivery_event('msg_task23null0004',
  '50000000-0000-4000-8000-000000000011','50000000-0000-4000-8000-000000000012',
  'delivered',null),'invalid_input','a null provider event time is rejected');
reset role;
select is((select count(*)::text||'|'||(select count(*) from public.communication_pending_delivery_events)
  from public.communication_delivery_events),'0|0','null provider events create no durable evidence');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(public.preview_decision_message_batch_v2(null,
  '50000000-0000-4000-8000-000000000010','selected','Copy','builtin:selected',1)->>'outcome',
  'invalid_input','preview rejects a null organization');
select is(public.preview_decision_message_batch_v2('50000000-0000-4000-8000-000000000002',
  null,'selected','Copy','builtin:selected',1)->>'outcome','invalid_input','preview rejects a null roster');
select is(public.preview_decision_message_batch_v2('50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000010',null,'Copy','builtin:selected',1)->>'outcome',
  'invalid_input','preview rejects a null decision kind');
select is(public.preview_decision_message_batch_v2('50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000010','selected',null,'builtin:selected',1)->>'outcome',
  'invalid_input','preview rejects null editable copy');
select is(public.preview_decision_message_batch_v2('50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000010','selected','Copy',null,1)->>'outcome',
  'invalid_input','preview rejects a null template id');
select is(public.preview_decision_message_batch_v2('50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000010','selected','Copy','builtin:selected',null)->>'outcome',
  'invalid_input','preview rejects a null template version');
reset role;
select is((select count(*)::text from public.communication_preview_proofs
  where organization_id='50000000-0000-4000-8000-000000000002'),'7',
  'null preview requests create no additional proof');

set local role authenticated;
select is(public.save_communication_template(null,'selected','Copy',0)->>'outcome',
  'invalid_input','template save rejects a null organization');
select is(public.save_communication_template('50000000-0000-4000-8000-000000000002',null,'Copy',0)->>'outcome',
  'invalid_input','template save rejects a null message kind');
select is(public.save_communication_template('50000000-0000-4000-8000-000000000002','selected',null,0)->>'outcome',
  'invalid_input','template save rejects null editable copy');
select is(public.save_communication_template('50000000-0000-4000-8000-000000000002','selected','Copy',null)->>'outcome',
  'invalid_input','template save rejects a null expected version');
reset role;
select is((select count(*)::text from public.communication_templates
  where organization_id='50000000-0000-4000-8000-000000000002'),'0',
  'null template requests create no template state');

set local role authenticated;
select throws_ok($$select * from public.list_communication_templates_for_notice(
  null,'50000000-0000-4000-8000-000000000003')$$,'42501','forbidden',
  'template listing rejects a null organization scope');
select throws_ok($$select * from public.list_communication_templates_for_notice(
  '50000000-0000-4000-8000-000000000002',null)$$,'42501','forbidden',
  'template listing rejects a null tryout scope');
reset role;

update public.communication_preview_proofs
set issued_at=clock_timestamp()-interval '20 minutes',
  expires_at=clock_timestamp()-interval '10 minutes'
where token_digest=encode(extensions.digest(convert_to(
  (select payload->>'previewToken' from task23_null_previews where label='case-1'),'UTF8'),'sha256'),'hex');
select set_config('request.jwt.claim.role','',true);
set local role service_role;
select throws_ok($$select public.purge_expired_communication_previews(null)$$,
  '22023','invalid purge limit','a null purge limit cannot become an unbounded delete');
reset role;
select is((select count(*)::text from public.communication_preview_proofs
  where organization_id='50000000-0000-4000-8000-000000000002'),'7',
  'a rejected null purge preserves every remaining proof');

select * from finish();
rollback;
