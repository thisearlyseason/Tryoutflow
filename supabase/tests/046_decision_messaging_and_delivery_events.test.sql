begin;
select plan(27);

select has_table('public','communication_templates','organization templates exist');
select has_table('public','communication_batches','confirmed batches exist');
select has_table('public','communication_delivery_events','provider evidence exists');
select has_column('public','communication_messages','protected_facts_snapshot','protected facts are immutable snapshots');
select has_column('public','communication_messages','communication_batch_id','messages bind to one exact batch');
select has_column('public','communication_messages','delivery_state_at','delivery evidence time is retained');
select has_type('public','claimed_outbox_job','worker projection remains a named database contract');
select col_is_pk('public','communication_delivery_events','event_id','provider event IDs deduplicate');
select col_is_unique('public','communication_batches',array['organization_id','preview_digest'],'exact previews replay one batch');

select ok(has_function_privilege('authenticated',
  'public.preview_decision_message_batch_v2(uuid,uuid,text,text,text,bigint)','execute'),
  'authenticated operators can preview an authorized template-bound exact audience');
select ok(not has_function_privilege('authenticated',
  'public.create_decision_message_batch(uuid,uuid,bigint,text,text,text,uuid[],text)','execute'),
  'legacy digest-only batch command is retired');
select ok(not has_function_privilege('anon',
  'public.create_decision_message_batch(uuid,uuid,bigint,text,text,text,uuid[],text)','execute'),
  'anonymous callers cannot create batches');
select ok(has_function_privilege('service_role',
  'public.apply_resend_delivery_event(text,uuid,text,text,timestamp with time zone)','execute'),
  'only the server webhook boundary can apply provider evidence');
select ok(not has_function_privilege('authenticated',
  'public.apply_resend_delivery_event(text,uuid,text,text,timestamp with time zone)','execute'),
  'browser sessions cannot forge provider evidence');
select ok(not has_function_privilege('service_role',
  'private.delivery_precedence(text)','execute'),
  'delivery transition helper remains private');
select ok(not has_function_privilege('service_role',
  'private.escape_message_html(text)','execute'),
  'HTML escape helper remains private');
select is(private.safe_message_header(E'Tryout\r\nBcc: attacker@example.com'),
  'Tryout  Bcc: attacker@example.com','subject facts cannot inject another header line');

select is((select relrowsecurity from pg_class where oid='public.communication_templates'::regclass),true,
  'templates enforce RLS');
select is((select relrowsecurity from pg_class where oid='public.communication_batches'::regclass),true,
  'batches enforce RLS');
select is((select relrowsecurity from pg_class where oid='public.communication_delivery_events'::regclass),true,
  'delivery evidence enforces RLS');
select ok(not has_table_privilege('authenticated','public.communication_batches','insert'),
  'clients cannot bypass atomic batch creation');
select ok(not has_table_privilege('service_role','public.communication_delivery_events','insert'),
  'service role cannot bypass the constrained provider event RPC');
select ok(not has_table_privilege('authenticated','public.communication_delivery_events','update'),
  'clients cannot rewrite provider evidence');
select ok((select pg_get_constraintdef(oid) like '%event_confirmed%'
  from pg_constraint where conname='outbox_provider_handoffs_attempt_state'),
  'signed provider evidence has a distinct terminal handoff state');

select is(private.delivery_precedence('submitted'),2,'submitted precedence is stable');
select is(private.delivery_precedence('delivered'),4,'delivered advances submitted');
select is(private.delivery_precedence('complained'),8,'complaints are terminal highest-severity evidence');

select * from finish();
rollback;
