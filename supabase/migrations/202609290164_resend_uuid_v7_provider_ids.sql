-- Resend now issues canonical UUIDv7 email IDs. Keep the provider-specific
-- completion and webhook contract aligned with the adapter without admitting
-- arbitrary strings or changing application UUID validation.
create or replace function private.is_canonical_provider_message_id(p_value text)
returns boolean language sql immutable parallel safe set search_path='' as $$
  select p_value is not null
    and p_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;
