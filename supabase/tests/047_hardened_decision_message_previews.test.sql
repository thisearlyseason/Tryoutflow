begin;
select plan(21);
select has_table('public','communication_preview_proofs','actor-bound preview proofs are persisted');
select has_table('public','communication_pending_delivery_events','early callbacks are persisted');
select has_column('public','communication_messages','source_tryout_id','send source binds tryout');
select has_column('public','communication_messages','source_division_id','send source binds division');
select ok(exists(select 1 from pg_constraint where conname='communication_messages_source_tryout_fkey'),
  'source tryout metadata has an exact tenant foreign key');
select ok(exists(select 1 from pg_constraint where conname='communication_messages_source_division_fkey'),
  'source division metadata has an exact tryout foreign key');
select ok(exists(select 1 from pg_constraint where conname='communication_messages_batch_source_scope'),
  'new batch messages require exact source scope metadata');
select ok(has_function_privilege('authenticated','public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text)','execute'),
  'authenticated operators consume constrained preview proofs');
select ok(not has_function_privilege('anon','public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text)','execute'),
  'anonymous callers cannot consume proofs');
select ok(not has_function_privilege('authenticated','public.create_decision_message_batch(uuid,uuid,bigint,text,text,text,uuid[],text)','execute'),
  'legacy digest-only confirmation is inaccessible');
select ok(has_function_privilege('authenticated','public.save_communication_template(uuid,text,text,bigint)','execute'),
  'administrators have a constrained versioned template command');
select ok(not has_table_privilege('authenticated','public.communication_preview_proofs','select'),
  'browser sessions cannot enumerate proof hashes or snapshots');
select ok(not has_table_privilege('service_role','public.communication_pending_delivery_events','insert'),
  'service role cannot bypass the event RPC');
select is((select relrowsecurity from pg_class where oid='public.communication_preview_proofs'::regclass),true,
  'proof table has RLS defense in depth');
select is((select relrowsecurity from pg_class where oid='public.communication_pending_delivery_events'::regclass),true,
  'pending evidence has RLS defense in depth');
select trigger_is('public','communication_messages','reconcile_pending_resend_events',
  'private','reconcile_pending_resend_events','provider completion reconciles early callbacks');
select trigger_is('public','communication_pending_delivery_events','prevent_pending_delivery_events_mutation',
  'private','prevent_communication_evidence_mutation','pending callbacks are append-only');
select ok(not has_function_privilege('service_role','private.render_decision_message_payload(uuid,uuid,text,text)','execute'),
  'authoritative renderer is private');
select ok(not has_function_privilege('authenticated','private.lock_communication_source_reason(uuid)','execute'),
  'execution-time source validator is private');
select col_is_pk('public','communication_preview_proofs','token_digest','proof tokens are stored only as unique hashes');
select col_is_pk('public','communication_pending_delivery_events','event_id','pending callbacks deduplicate globally');
select * from finish();
rollback;
