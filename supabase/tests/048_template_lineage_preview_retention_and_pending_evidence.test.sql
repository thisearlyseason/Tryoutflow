begin;
select plan(26);

select has_column('public','communication_templates','id','templates have stable lineage IDs');
select has_column('public','communication_batches','template_id','batches snapshot template IDs');
select has_column('public','communication_batches','template_version','batches snapshot template versions');
select has_column('public','communication_messages','source_template_id','messages snapshot template IDs');
select has_column('public','communication_messages','source_template_version','messages snapshot template versions');
select ok(exists(select 1 from pg_constraint where conname='communication_messages_batch_template_fkey'),
  'message template snapshots bind the exact batch lineage');
select has_column('public','communication_preview_proofs','template_id','active previews bind template IDs');
select has_column('public','communication_preview_proofs','template_version','active previews bind template versions');
select has_table('public','communication_preview_tombstones','consumed previews retain PII-free replay tombstones');
select col_is_pk('public','communication_preview_tombstones','token_digest','tombstones remain exact one-use capabilities');
select columns_are('public','communication_preview_tombstones',array[
  'token_digest','render_digest','binding_digest','communication_batch_id','consumed_at'
], 'consumed tombstones contain only hashes, batch lineage, and time');
select ok(has_function_privilege('authenticated','public.preview_decision_message_batch_v2(uuid,uuid,text,text,text,bigint)','execute'),
  'authorized senders use template-version-bound preview RPC');
select ok(not has_function_privilege('authenticated','public.preview_decision_message_batch(uuid,uuid,text,text)','execute'),
  'unversioned preview RPC is revoked');
select ok(has_function_privilege('authenticated','public.list_communication_templates_for_notice(uuid,uuid)','execute'),
  'authorized senders can load configured template lineage through a constrained RPC');
select ok(has_function_privilege('service_role','public.purge_expired_communication_previews(integer)','execute'),
  'processor can invoke bounded expired-preview cleanup');
select ok(not has_table_privilege('authenticated','public.communication_preview_tombstones','select'),
  'sessions cannot enumerate replay tombstones');
select ok(exists(select 1 from pg_constraint where conname='communication_preview_proofs_org_fkey' and confdeltype='c'),
  'active previews cascade with organization lifecycle');
select ok(exists(select 1 from pg_constraint where conname='communication_preview_proofs_actor_fkey' and confdeltype='c'),
  'active previews cascade with actor lifecycle');
select has_column('public','communication_pending_delivery_events','organization_id','early evidence binds tenant identity');
select ok(exists(select 1 from pg_constraint where conname='communication_pending_events_message_fkey' and confdeltype='r'),
  'early evidence has exact tenant/message restrictive parent binding');
select trigger_is('public','communication_pending_delivery_events','deny_pending_delivery_events_truncate',
  'private','prevent_communication_evidence_mutation','pending evidence rejects truncate');
select is((select tgenabled from pg_trigger where tgrelid='public.communication_pending_delivery_events'::regclass
  and tgname='deny_pending_delivery_events_truncate'),'A','pending truncate protection is always enabled');
select ok(not has_table_privilege('service_role','public.communication_pending_delivery_events','truncate'),
  'service role cannot truncate pending evidence');
select ok(not has_table_privilege('authenticated','public.communication_templates','update'),
  'configured templates cannot be changed outside the CAS command');
select ok(not has_function_privilege('anon','public.list_communication_templates_for_notice(uuid,uuid)','execute'),
  'anonymous callers cannot read configured templates');
select ok(not has_function_privilege('anon','public.purge_expired_communication_previews(integer)','execute'),
  'anonymous callers cannot purge previews');

select * from finish();
rollback;
