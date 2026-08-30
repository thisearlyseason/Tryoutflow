begin;
select plan(26);

select has_column('public','communication_messages','source_binding_version','messages record source-binding version');
select has_column('public','communication_messages','source_registration_id','messages bind registration identity');
select has_column('public','communication_messages','source_guardian_id','messages bind guardian identity');
select has_column('public','communication_messages','source_roster_version_id','messages bind roster identity');
select has_column('public','communication_messages','source_expected_decision','messages bind finalized decision');
select has_column('public','communication_messages','source_confirmation_token_digest','confirmations bind token digest');
select has_column('public','communication_messages','source_invitation_token_digest','invitations bind token digest');
select has_column('public','communication_messages','source_authorizing_user_id','messages bind authorizing member');
select has_column('public','communication_messages','cancellation_reason','terminal cancellation is truthful');
select has_column('public','outbox_jobs','provider_submission_started_at','in-flight provider submission is durable');
select has_function('public','queue_registration_communication_v2',array['uuid','uuid','uuid','text','text','text','text'],'server-owned registration command boundary exists');
select has_function('public','queue_registration_confirmation_communication_v2',array['uuid','text','text','text','text','text'],'token-bound confirmation boundary exists');
select has_function('public','queue_invitation_communication_v2',array['uuid','uuid','text','text','text','text'],'token-bound invitation boundary exists');
select has_function('public','authorize_outbox_job_send_v2',array['uuid','uuid','bigint','integer','integer'],'pre-provider authorization boundary exists');
select ok(not has_function_privilege('authenticated','public.queue_registration_communication(uuid,uuid,uuid,text,text,text,text,text)','execute'),'legacy caller-classified registration boundary is closed');
select ok(not has_function_privilege('service_role','public.queue_registration_communication(uuid,uuid,uuid,text,text,text,text,text)','execute'),'service cannot bypass canonical registration boundary');
select ok(has_function_privilege('authenticated','public.queue_registration_communication_v2(uuid,uuid,uuid,text,text,text,text)','execute'),'authenticated caller may use strict command boundary');
select ok(not has_function_privilege('anon','public.queue_registration_communication_v2(uuid,uuid,uuid,text,text,text,text)','execute'),'anonymous caller cannot queue reminders');
select ok(not has_function_privilege('authenticated','public.queue_registration_confirmation_communication_v2(uuid,text,text,text,text,text)','execute'),'confirmation adapter remains service-only');
select ok(has_function_privilege('service_role','public.queue_registration_confirmation_communication_v2(uuid,text,text,text,text,text)','execute'),'service may queue exact current confirmation token');
select ok(not has_function_privilege('authenticated','public.authorize_outbox_job_send_v2(uuid,uuid,bigint,integer,integer)','execute'),'only service may authorize a provider send');
select ok(has_function_privilege('service_role','public.authorize_outbox_job_send_v2(uuid,uuid,bigint,integer,integer)','execute'),'service must reauthorize immediately before provider');
select is((select count(*) from public.communication_messages where recipient_snapshot ? 'name'),0::bigint,
  'stored snapshots contain no guardian names');
select col_type_is('public','outbox_jobs','lease_expires_at','timestamp with time zone','lease deadline remains explicit');
select ok(not has_function_privilege('authenticated','public.queue_invitation_communication(uuid,uuid,text,text,text)','execute'),'legacy invitation boundary without token proof is closed');
select ok(has_function_privilege('service_role','public.queue_invitation_communication_v2(uuid,uuid,text,text,text,text)','execute'),'service invitation adapter binds token proof');

select * from finish();
rollback;
