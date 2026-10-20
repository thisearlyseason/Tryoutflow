alter table private.billing_purchase_intents add column provider_session_id text unique;
create function public.complete_billing_checkout(p_intent_id uuid,p_session_id text) returns void language plpgsql security definer set search_path='' as $$
declare intent private.billing_purchase_intents%rowtype;
begin
 if p_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9_]{8,250}$' then raise exception 'invalid_checkout_session'; end if;
 select * into intent from private.billing_purchase_intents where id=p_intent_id and provider='stripe' for update;
 if not found or (intent.provider_session_id is not null and intent.provider_session_id<>p_session_id) then raise exception 'checkout_session_conflict'; end if;
 update private.billing_purchase_intents set provider_session_id=p_session_id where id=p_intent_id;
end $$;
revoke all on function public.complete_billing_checkout(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_billing_checkout(uuid,text) to service_role;
