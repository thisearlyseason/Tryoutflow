-- Migration 071 could not distinguish a provider metadata claim from an organization resolved
-- through an existing customer/subscription mapping and therefore fabricated claim evidence for
-- some historical rows. Rebuild that one derived column from the exact allow-listed payload field
-- shipped by the verified webhook parser. Never infer a claim from bound tenant state.

create function private.subscription_event_claimed_organization_id(p_payload jsonb)
returns uuid language sql immutable parallel safe set search_path='' as $$
  select case
    when pg_catalog.jsonb_typeof(p_payload)='object'
      and pg_catalog.jsonb_typeof(p_payload->'organizationId')='string'
      and (p_payload->>'organizationId') ~
        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    then (p_payload->>'organizationId')::uuid
    else null::uuid
  end
$$;

revoke all on function private.subscription_event_claimed_organization_id(jsonb)
from public,anon,authenticated,service_role;

-- The event mutation guard is suspended only for this additive repair. Payload, digest, actual
-- bound organization, outcome, and all provider/replay evidence remain byte-for-byte untouched.
alter table public.subscription_events disable trigger guard_subscription_event_mutation;
update public.subscription_events
set claimed_organization_id=private.subscription_event_claimed_organization_id(payload);
alter table public.subscription_events enable trigger guard_subscription_event_mutation;
