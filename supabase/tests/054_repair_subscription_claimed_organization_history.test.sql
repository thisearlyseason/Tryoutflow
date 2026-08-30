begin;
select plan(12);

select has_function('private','subscription_event_claimed_organization_id',array['jsonb'],
  'historical claim extraction has one narrow payload-only boundary');

select is(private.subscription_event_claimed_organization_id(
  '{"organizationId":"54000000-0000-4000-8000-000000000010"}'::jsonb),
  '54000000-0000-4000-8000-000000000010'::uuid,
  'the exact shipped allow-listed organizationId field is retained');
select is(private.subscription_event_claimed_organization_id(
  '{"organizationId":"54000000-0000-4000-8000-000000000020","organization_id":"54000000-0000-4000-8000-000000000099"}'::jsonb),
  '54000000-0000-4000-8000-000000000020'::uuid,
  'alternate metadata spellings cannot override the shipped evidence field');
select is(private.subscription_event_claimed_organization_id(
  '{"organizationId":"54000000-0000-4000-8000-0000000000AA"}'::jsonb),
  '54000000-0000-4000-8000-0000000000aa'::uuid,
  'UUID text accepted by the shipped application validator retains the exact UUID value');
select is(private.subscription_event_claimed_organization_id(
  '{"organizationId":"00000000-0000-0000-0000-000000000000"}'::jsonb),
  '00000000-0000-0000-0000-000000000000'::uuid,
  'the RFC nil UUID accepted by the shipped application validator is valid evidence');

select is(private.subscription_event_claimed_organization_id('{}'::jsonb),null::uuid,
  'an omitted organizationId remains an absent claim');
select is(private.subscription_event_claimed_organization_id('{"organizationId":null}'::jsonb),
  null::uuid,'an explicit null organizationId remains an absent claim');
select is(private.subscription_event_claimed_organization_id('{"organizationId":42}'::jsonb),
  null::uuid,'a non-string organizationId cannot become a claim');
select is(private.subscription_event_claimed_organization_id(
  '{"organizationId":{"value":"54000000-0000-4000-8000-000000000010"}}'::jsonb),
  null::uuid,'a structured organizationId cannot crash or become a claim');
select is(private.subscription_event_claimed_organization_id(
  '{"organizationId":"not-a-uuid"}'::jsonb),null::uuid,
  'malformed UUID text cannot crash or become a claim');
select is(private.subscription_event_claimed_organization_id(
  '{"organizationId":"{54000000-0000-4000-8000-000000000010}"}'::jsonb),null::uuid,
  'PostgreSQL-only UUID spellings are rejected as noncanonical provider evidence');
select is(private.subscription_event_claimed_organization_id(
  '{"organization_id":"54000000-0000-4000-8000-000000000010"}'::jsonb),null::uuid,
  'unshipped alternate keys are ignored rather than guessed');

select * from finish();
rollback;
