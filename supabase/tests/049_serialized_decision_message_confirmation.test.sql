begin;
select plan(6);

select has_function('public','create_decision_message_batch_v2',array[
  'uuid','uuid','uuid','uuid','text','text','text'
], 'versioned decision-batch confirmation remains installed');
select ok(has_function_privilege('authenticated',
  'public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text)','execute'),
  'authenticated senders retain the confirmation RPC');
select ok(not has_function_privilege('anon',
  'public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text)','execute'),
  'anonymous callers cannot invoke confirmation');
select ok(not has_table_privilege('authenticated','public.communication_preview_proofs','select'),
  'authenticated callers cannot enumerate live proof capabilities');
select ok(not has_table_privilege('authenticated','public.communication_preview_tombstones','select'),
  'authenticated callers cannot enumerate consumed capabilities');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000049',true);
select is((select outcome from public.create_decision_message_batch_v2(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',
  repeat('a',64),repeat('b',64),'SEND EXACT BATCH')),'forbidden',
  'unknown well-shaped capabilities fail closed without exposing proof state');
reset role;

select * from finish();
rollback;
