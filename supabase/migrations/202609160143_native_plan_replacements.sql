-- RevenueCat can issue a new subscription ID on an in-store plan change. Carry the
-- existing organization binding only across a verified, adjacent product replacement.
create function public.reserve_native_plan_replacement(p_id uuid,p_previous_id uuid,p_snapshot jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.billing_contracts%rowtype; started timestamptz:=coalesce((p_snapshot->>'purchase_started_at')::timestamptz,(p_snapshot->>'current_period_start')::timestamptz);
begin
 select * into previous from public.billing_contracts where id=p_previous_id for update;
 if not found or previous.provider not in ('apple','google') or previous.tryout_id is not null or previous.status<>'expired'
 or previous.purchaser_id::text<>p_snapshot->>'purchaser_id' or previous.provider<>p_snapshot->>'provider'
 or previous.environment<>p_snapshot->>'environment' or previous.provider_customer_id<>p_snapshot->>'provider_customer_id'
 or previous.product_key=p_snapshot->>'product_key' or previous.current_period_end is null
 or abs(extract(epoch from (started-previous.current_period_end)))>300
 or (select kind from public.billing_products where key=p_snapshot->>'product_key')<>'subscription'
 then raise exception 'replacement_attribution_required'; end if;
 insert into private.billing_purchase_intents(id,organization_id,tryout_id,purchaser_id,product_key,provider,environment,created_at,expires_at)
 values(p_id,previous.organization_id,null,previous.purchaser_id,p_snapshot->>'product_key',previous.provider,previous.environment,started-interval '1 second',started+interval '1 hour')
 on conflict(id) do nothing;
 if not exists(select 1 from private.billing_purchase_intents where id=p_id and organization_id=previous.organization_id and purchaser_id=previous.purchaser_id and product_key=p_snapshot->>'product_key') then raise exception 'intent_conflict'; end if;
 return p_id;
end $$;
revoke all on function public.reserve_native_plan_replacement(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reserve_native_plan_replacement(uuid,uuid,jsonb) to service_role;
