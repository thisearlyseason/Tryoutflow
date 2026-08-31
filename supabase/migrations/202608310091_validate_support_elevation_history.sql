-- Migration 090 deliberately introduced new checks as NOT VALID so new writes were closed without
-- blocking deployment on historical evidence. Complete that upgrade without rewriting or deleting
-- the original evidence: malformed, expired, or future-created open rows are explicitly revoked,
-- an immutable invalidation event is appended, and only then are the active-row checks validated.

begin;

lock table public.platform_support_elevations in share row exclusive mode;

alter table public.platform_support_elevations
  drop constraint platform_support_elevations_reason_not_blank,
  drop constraint platform_support_elevations_reason_bound_check,
  drop constraint platform_support_elevations_duration_bound_check;

alter table public.platform_support_elevations
  add constraint platform_support_elevations_reason_not_blank
    check(revoked_at is not null or char_length(trim(reason)) between 10 and 2000) not valid,
  add constraint platform_support_elevations_reason_bound_check
    check(
      revoked_at is not null
      or (char_length(trim(reason)) between 10 and 500 and reason !~ '[[:cntrl:]]')
    ) not valid,
  add constraint platform_support_elevations_duration_bound_check
    check(
      revoked_at is not null
      or (
        expires_at>=created_at+interval '5 minutes'
        and expires_at<=created_at+interval '4 hours'
      )
    ) not valid;

with migration_clock as (
  select clock_timestamp() as recorded_at
), invalidated as (
  update public.platform_support_elevations elevation
  set revoked_at=migration_clock.recorded_at
  from migration_clock
  where elevation.revoked_at is null
    and (
      char_length(trim(elevation.reason)) not between 10 and 500
      or elevation.reason ~ '[[:cntrl:]]'
      or elevation.expires_at<elevation.created_at+interval '5 minutes'
      or elevation.expires_at>elevation.created_at+interval '4 hours'
      or elevation.created_at>migration_clock.recorded_at
      or elevation.expires_at<=migration_clock.recorded_at
    )
  returning elevation.id,elevation.organization_id,elevation.support_user_id,
    elevation.reason,elevation.created_at,elevation.expires_at,elevation.revoked_at
)
insert into public.audit_logs(
  id,organization_id,actor_user_id,action,entity_type,entity_id,occurred_at,details
)
select
  gen_random_uuid(),invalidated.organization_id,null,
  'platform.support_elevation.invalidated','platform_support_elevation',invalidated.id,
  invalidated.revoked_at,
  jsonb_build_object(
    'reasonCodes',
    to_jsonb(array_remove(array[
      case when char_length(trim(invalidated.reason))<10 then 'reason_too_short' end,
      case when char_length(trim(invalidated.reason))>500 then 'reason_too_long' end,
      case when invalidated.reason ~ '[[:cntrl:]]' then 'reason_control_character' end,
      case when invalidated.expires_at<invalidated.created_at+interval '5 minutes' then 'duration_too_short' end,
      case when invalidated.expires_at>invalidated.created_at+interval '4 hours' then 'duration_too_long' end,
      case when invalidated.created_at>invalidated.revoked_at then 'created_in_future' end,
      case when invalidated.expires_at<=invalidated.revoked_at then 'expired' end
    ],null))
  )
from invalidated;

alter table public.platform_support_elevations
  validate constraint platform_support_elevations_reason_not_blank;
alter table public.platform_support_elevations
  validate constraint platform_support_elevations_reason_bound_check;
alter table public.platform_support_elevations
  validate constraint platform_support_elevations_duration_bound_check;

create or replace function public.has_active_platform_support_elevation(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.is_active_platform_administrator() and exists(
    select 1 from public.platform_support_elevations elevation
    where elevation.organization_id=target_organization_id
      and elevation.support_user_id=auth.uid()
      and elevation.revoked_at is null
      and char_length(trim(elevation.reason)) between 10 and 500
      and elevation.reason !~ '[[:cntrl:]]'
      and elevation.created_at<=statement_timestamp()
      and elevation.expires_at>statement_timestamp()
      and elevation.expires_at>=elevation.created_at+interval '5 minutes'
      and elevation.expires_at<=elevation.created_at+interval '4 hours'
  );
$$;

revoke all on function public.has_active_platform_support_elevation(uuid)
from public,anon,authenticated,service_role;

commit;
