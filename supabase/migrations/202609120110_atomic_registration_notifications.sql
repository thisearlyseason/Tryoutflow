-- Both the submitted registration and configured organizer notice commit together.
-- Provider delivery remains entirely in the existing durable outbox worker.
create function public.submit_public_registration_with_notification(
  p_tryout_slug text,
  p_submission jsonb,
  p_idempotency_key text,
  p_rate_key_hash text,
  p_app_origin text
) returns table(outcome text,registration_id uuid,confirmation_token text)
language plpgsql security definer set search_path='' as $$
declare submitted record; notice public.queue_communication_result;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select * into submitted from public.submit_public_registration_v2(
    p_tryout_slug,p_submission,p_idempotency_key,p_rate_key_hash
  );
  if not found then raise exception 'registration_outcome_missing' using errcode='XX000'; end if;
  if submitted.outcome in ('submitted','replayed') then
    notice:=public.queue_organizer_registration_notification(submitted.registration_id,p_app_origin);
    -- Suppressed means no configured destination. Forbidden here can only mean
    -- its configuring manager was offboarded: this wrapper already checks role.
    if notice.outcome is null or notice.outcome not in ('queued','replayed','suppressed','forbidden') then
      raise exception 'organizer_notification_not_persisted' using errcode='XX000';
    end if;
  end if;
  return query select submitted.outcome::text,submitted.registration_id::uuid,submitted.confirmation_token::text;
end $$;
revoke all on function public.submit_public_registration_with_notification(text,jsonb,text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.submit_public_registration_with_notification(text,jsonb,text,text,text) to service_role;
-- Keep the previous service entry point available during application promotion.
-- Migration111 closes it after all traffic uses the atomic entry point.
