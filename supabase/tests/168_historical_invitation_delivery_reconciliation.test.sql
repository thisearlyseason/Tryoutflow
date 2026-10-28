begin;
select no_plan();
select is(private.reconcile_20260930_invitation_deliveries(),0,'fresh databases have nothing to reconcile');
select ok(not has_function_privilege('anon','private.reconcile_20260930_invitation_deliveries()','execute'),'anonymous cannot reconcile');
select ok(not has_function_privilege('authenticated','private.reconcile_20260930_invitation_deliveries()','execute'),'signed-in users cannot reconcile');
select ok(not has_function_privilege('service_role','private.reconcile_20260930_invitation_deliveries()','execute'),'runtime service cannot run operator repair');

insert into auth.users(id,email) values('f1680000-0000-4000-8000-000000000001','repair-coach@example.test');
insert into public.organizations(id,name,slug) values('f1680000-0000-4000-8000-000000000002','Repair QA','repair-invitation-qa');
insert into public.organization_members(organization_id,user_id,role) values
('f1680000-0000-4000-8000-000000000002','f1680000-0000-4000-8000-000000000001','owner');
create temporary table repair_targets(job_id uuid,message_id uuid,invitation_id uuid,expires_at timestamptz,delivered boolean);
insert into repair_targets values
('1b5e5294-032c-42cc-a059-bf01b2298960','40621748-6550-4655-a51e-37553654c7f1','328edb76-3ee2-42f3-bfde-e86ed8878c97','2026-10-07 02:01:26.226+00',false),
('41c8ef42-2d5d-4c95-bdfc-8eda0079cc3c','bb767b8f-60cb-4f32-8c26-5d203ce75956','9e4769bf-226c-47a4-94d1-09821d2c745b','2026-10-07 02:16:37.891+00',false),
('9bb12d83-2299-4dd0-b3ff-67de55e2a0f3','354f0b25-b67b-4cd0-b954-6a65531fcf52','8489a3a3-7070-4af0-9973-5e7133acee45','2026-10-07 02:20:44.481+00',true);
insert into public.organization_invitations(id,organization_id,email,role,token_digest,created_at,expires_at,created_by_user_id)
select invitation_id,'f1680000-0000-4000-8000-000000000002',message_id::text||'@example.test','member',
  encode(extensions.digest(invitation_id::text,'sha256'),'hex'),'2026-09-30',expires_at,'f1680000-0000-4000-8000-000000000001'
from repair_targets;
insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
  business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
  source_invitation_token_digest,source_authorizing_user_id,created_at)
select message_id,'f1680000-0000-4000-8000-000000000002','invitation',invitation_id,'member_invitation','operational',
  'repair:'||message_id,repeat('a',64),jsonb_build_object('email',message_id::text||'@example.test'),
  '{"subject":"Fictional QA invitation","text":"Fictional QA body"}',1,
  encode(extensions.digest(invitation_id::text,'sha256'),'hex'),'f1680000-0000-4000-8000-000000000001','2026-09-30'
from repair_targets;
insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,
  status,attempt_count,lease_owner,lease_token,lease_generation,lease_expires_at,created_at,provider_submission_started_at)
select job_id,'f1680000-0000-4000-8000-000000000002',message_id,'repair:'||message_id,'communication:'||message_id,
  'leased',1,'fictional-qa',gen_random_uuid(),1,'2026-09-30 02:22:00+00','2026-09-30','2026-09-30 02:20:56+00'
from repair_targets;
insert into public.outbox_provider_handoffs(organization_id,job_id,message_id,lease_token,lease_generation,
  started_at,provider_idempotency_key)
select organization_id,id,message_id,lease_token,lease_generation,provider_submission_started_at,provider_idempotency_key
from public.outbox_jobs where id in(select job_id from repair_targets);
update public.outbox_provider_handoffs h set attempt_state=case when t.delivered then 'delivery_uncertain' else 'provider_failed' end,
  resolved_at='2026-09-30 02:20:57+00' from repair_targets t where h.job_id=t.job_id;
update public.communication_messages m set state=case when t.delivered then 'delivery_uncertain' else 'failed' end,
  attention_required_at='2026-09-30 02:20:57+00' from repair_targets t where m.id=t.message_id;
update public.outbox_jobs j set status=case when t.delivered then 'needs_attention' else 'dead_letter' end,
  last_error_code=case when t.delivered then 'delivery_uncertain' else 'provider_rejected' end,
  delivery_uncertain_at=case when t.delivered then '2026-09-30 02:20:57+00'::timestamptz end,
  delivery_uncertain_reason=case when t.delivered then 'delivery_uncertain' end,
  dead_lettered_at=case when not t.delivered then '2026-09-30 02:20:57+00'::timestamptz end,
  lease_owner=null,lease_token=null,lease_expires_at=null from repair_targets t where j.id=t.job_id;

create temporary table repair_preserved as select
  (select jsonb_agg(to_jsonb(t) order by t.job_id,t.lease_generation) from public.outbox_provider_handoffs t) as handoffs,
  (select jsonb_agg(to_jsonb(t) order by t.id) from public.organization_invitations t) as invitations,
  (select jsonb_agg(to_jsonb(t) order by t.organization_id,t.user_id) from public.organization_members t) as members,
  (select jsonb_agg(to_jsonb(t) order by t.organization_id) from public.subscription_accounts t) as subscriptions,
  (select jsonb_agg(to_jsonb(t) order by t.id) from public.participant_links t) as links,
  (select count(*) from public.communication_delivery_events) as event_count;

update public.outbox_jobs set attempt_count=2 where id='41c8ef42-2d5d-4c95-bdfc-8eda0079cc3c';
select throws_ok($$select private.reconcile_20260930_invitation_deliveries()$$,'23514',null,'changed attempt evidence aborts repair');
select is((select status from public.outbox_jobs where id='1b5e5294-032c-42cc-a059-bf01b2298960'),'dead_letter','earlier repair is rolled back atomically');
select is((select count(*) from public.audit_logs where action='communication.historical_delivery_reconciled'),0::bigint,'failed repair leaves no partial audit');
update public.outbox_jobs set attempt_count=1 where id='41c8ef42-2d5d-4c95-bdfc-8eda0079cc3c';
select throws_ok($$update public.organization_invitations set expires_at=expires_at+interval '1 second' where id='8489a3a3-7070-4af0-9973-5e7133acee45'$$,'55000',null,'existing source identity remains immutable');
select is(private.reconcile_20260930_invitation_deliveries(),3,'only three proven historical jobs are repaired');
select is(private.reconcile_20260930_invitation_deliveries(),0,'repair replay is idempotent');
select is((select count(*) from public.outbox_jobs where id in(select job_id from repair_targets) and status='cancelled'),2::bigint,'expired rejected sends are closed without retry');
select is((select count(*) from public.communication_messages where id in(select message_id from repair_targets where not delivered) and state='failed' and provider_message_id is null),2::bigint,'rejection truth remains failed');
select is((select state from public.communication_messages where id='354f0b25-b67b-4cd0-b954-6a65531fcf52'),'delivered','verified provider delivery is recorded');
select is((select provider_message_id from public.communication_messages where id='354f0b25-b67b-4cd0-b954-6a65531fcf52'),'01a0f01d-7021-724c-a281-c2dc60739d68','exact observed provider identifier is bound');
select is((select status from public.outbox_jobs where id='9bb12d83-2299-4dd0-b3ff-67de55e2a0f3'),'completed','uncertain job no longer retries');
select is((select count(*) from public.audit_logs where action='communication.historical_delivery_reconciled'),3::bigint,'one audit per repair survives replay');
select is((select jsonb_agg(to_jsonb(t) order by t.job_id,t.lease_generation) from public.outbox_provider_handoffs t),(select handoffs from repair_preserved),'original provider handoff history is unchanged');
select is((select count(*) from public.communication_delivery_events),(select event_count from repair_preserved),'no signed provider event is fabricated');
select is((select jsonb_agg(to_jsonb(t) order by t.organization_id,t.user_id) from public.organization_members t),(select members from repair_preserved),'coach membership is unchanged');
select is((select jsonb_agg(to_jsonb(t) order by t.organization_id) from public.subscription_accounts t),(select subscriptions from repair_preserved),'subscriptions and trials are unchanged');
select is((select jsonb_agg(to_jsonb(t) order by t.id) from public.participant_links t),(select links from repair_preserved),'athlete access is unchanged');
select is((select jsonb_agg(to_jsonb(t) order by t.id) from public.organization_invitations t),(select invitations from repair_preserved),'invitation authority and expiration are unchanged');
select * from finish();
rollback;
