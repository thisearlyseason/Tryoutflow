-- Saturate the durable limiter: the transaction sees a stable value above the
-- allowed threshold, while the stored counter can never grow without bound.
create function public.saturate_registration_rate_attempts() returns trigger language plpgsql set search_path='' as $$ begin if new.attempts > 11 then new.attempts:=11; end if; return new; end; $$;
create trigger saturate_registration_rate_attempts before insert or update of attempts on public.registration_rate_counters for each row execute function public.saturate_registration_rate_attempts();

-- A revoked token is no longer active. Replace the earlier index which treated
-- a rotated-but-unconsumed token as active forever.
drop index public.registration_confirmation_tokens_active_registration_idx;
create unique index registration_confirmation_tokens_one_active_idx on public.registration_confirmation_tokens(organization_id,registration_id,purpose) where used_at is null and revoked_at is null;
revoke execute on function public.consume_registration_confirmation_token(text) from public, anon, authenticated;
grant execute on function public.consume_registration_confirmation_token(text) to service_role;

-- Keep the contact model ready for the public phone field. The submission
-- transaction stores phone only after a subsequent adapter migration consumes it.
alter table public.guardians add column phone text;
alter table public.guardians add constraint guardians_phone_format_check check (phone is null or phone ~ '^[+]?[0-9 ()-]{7,32}$');
