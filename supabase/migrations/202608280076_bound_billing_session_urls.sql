-- Stripe does not publish stable maximum lengths for hosted-session capabilities. Preserve the
-- existing 200-character provider object-ID suffix contract, allow 2 KiB for opaque Portal bearer
-- and Checkout fragment values, and retain the application's existing 4 KiB total URL envelope.
-- The accepted alphabet is ASCII, so both character and byte limits are explicit and equivalent.
create or replace function private.is_valid_billing_session_url(
  p_session_id text,p_url text,p_kind text
) returns boolean language sql immutable strict set search_path='' as $$
  select pg_catalog.char_length(p_url) between 1 and 4096
    and pg_catalog.octet_length(p_url) between 1 and 4096
    and case p_kind
    when 'checkout' then
      p_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{1,200}$'
      and pg_catalog.char_length(pg_catalog.split_part(p_session_id,'_',3)) between 1 and 200
      and pg_catalog.octet_length(pg_catalog.split_part(p_session_id,'_',3)) between 1 and 200
      and p_url !~ '[[:cntrl:]]'
      and p_url ~ '^https://checkout[.]stripe[.]com/c/pay/cs_(test|live)_[A-Za-z0-9]+(#([A-Za-z0-9._~!$&''()*+,;=:@/?-]|%[A-Fa-f0-9][A-Fa-f0-9])+)?$'
      and pg_catalog.substring(
        p_url,'^https://checkout[.]stripe[.]com/c/pay/(cs_(test|live)_[A-Za-z0-9]+)'
      )=p_session_id
      and (pg_catalog.strpos(p_url,'#')=0 or (
        pg_catalog.char_length(pg_catalog.split_part(p_url,'#',2)) between 1 and 2048
        and pg_catalog.octet_length(pg_catalog.split_part(p_url,'#',2)) between 1 and 2048
      ))
    when 'portal' then
      p_session_id ~ '^bps_[A-Za-z0-9]{1,200}$'
      and pg_catalog.char_length(pg_catalog.split_part(p_session_id,'_',2)) between 1 and 200
      and pg_catalog.octet_length(pg_catalog.split_part(p_session_id,'_',2)) between 1 and 200
      and p_url !~ '[[:cntrl:]]'
      and p_url ~ '^https://billing[.]stripe[.]com/p/session/(test|live)_[A-Za-z0-9]+$'
      and pg_catalog.char_length(pg_catalog.split_part(p_url,'_',2)) between 1 and 2048
      and pg_catalog.octet_length(pg_catalog.split_part(p_url,'_',2)) between 1 and 2048
    else false
  end
$$;
revoke all on function private.is_valid_billing_session_url(text,text,text)
from public,anon,authenticated,service_role;
