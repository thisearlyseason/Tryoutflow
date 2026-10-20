-- Match Stripe's two distinct hosted-session contracts. Checkout fragments are opaque RFC 3986
-- fragment data; Billing Portal object IDs are not the bearer token embedded in the redirect URL.
create or replace function private.is_valid_billing_session_url(
  p_session_id text,p_url text,p_kind text
) returns boolean language sql immutable strict set search_path='' as $$
  select case p_kind
    when 'checkout' then
      p_session_id ~ '^cs_(test|live)_[A-Za-z0-9]+$'
      and p_url !~ '[[:cntrl:]]'
      and p_url ~ '^https://checkout[.]stripe[.]com/c/pay/cs_(test|live)_[A-Za-z0-9]+(#([A-Za-z0-9._~!$&''()*+,;=:@/?-]|%[A-Fa-f0-9][A-Fa-f0-9])+)?$'
      and pg_catalog.substring(
        p_url,'^https://checkout[.]stripe[.]com/c/pay/(cs_(test|live)_[A-Za-z0-9]+)'
      )=p_session_id
      and (pg_catalog.strpos(p_url,'#')=0
        or pg_catalog.char_length(pg_catalog.split_part(p_url,'#',2)) between 1 and 2048)
    when 'portal' then
      p_session_id ~ '^bps_[A-Za-z0-9]+$'
      and p_url !~ '[[:cntrl:]]'
      and p_url ~ '^https://billing[.]stripe[.]com/p/session/(test|live)_[A-Za-z0-9]+$'
    else false
  end
$$;
revoke all on function private.is_valid_billing_session_url(text,text,text)
from public,anon,authenticated,service_role;
