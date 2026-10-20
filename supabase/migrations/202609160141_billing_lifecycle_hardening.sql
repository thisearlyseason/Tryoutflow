-- Serialize old and new checkout reservations against the same organization lock.
do $$ declare source text; begin
 select pg_get_functiondef('public.reserve_subscription_checkout_intent(uuid,uuid,text,uuid)'::regprocedure) into source;
 source:=replace(source,'  perform pg_catalog.pg_advisory_xact_lock(',
 $inject$  perform 1 from public.organizations where id=p_organization_id for update;
  if exists(select 1 from public.billing_contracts c where c.organization_id=p_organization_id and c.tryout_id is null
    and c.environment=(select environment from private.billing_configuration) and c.status in ('active','trialing','grace_period','past_due','cancelled','incomplete')
    and (c.current_period_end is null or greatest(c.current_period_end,c.grace_period_end)>now()))
   or exists(select 1 from private.billing_purchase_intents where organization_id=p_organization_id and expires_at>now() and contract_id is null)
  then return query select 'subscription_exists'::text,null::text,null::text,null::text; return; end if;
  perform pg_catalog.pg_advisory_xact_lock($inject$);
 execute source;
 select pg_get_functiondef('public.reserve_billing_purchase(uuid,uuid,uuid,text,text)'::regprocedure) into source;
 source:=replace(source,' select environment into env from private.billing_configuration;',
 $inject$ if exists(select 1 from public.subscription_checkout_intents where organization_id=p_organization_id and state in ('pending','completed') and expires_at>now()) then raise exception 'purchase_in_progress'; end if;
 select environment into env from private.billing_configuration;$inject$);
 execute source;
 -- A reconciliation of the same refunded billing period cannot accidentally restore its access.
 select pg_get_functiondef('public.apply_billing_snapshot(jsonb,jsonb,uuid)'::regprocedure) into source;
 source:=replace(source,' if result=''applied'' then',$inject$ if c.status='refunded' and p_snapshot->>'status' in ('active','trialing','grace_period','past_due','cancelled')
  and (p_snapshot->>'current_period_start')::timestamptz<=c.current_period_start
  and p_event->>'type'<>'REFUND_REVERSED' then p_snapshot:=p_snapshot||'{"status":"refunded"}'::jsonb; end if;
 if result='applied' then$inject$);
 execute source;
end $$;
do $$ declare source text; begin
 select pg_get_functiondef('public.apply_billing_snapshot(jsonb,jsonb,uuid)'::regprocedure) into source;
 source:=replace(source,'(p_snapshot->>''current_period_start'')::timestamptz<i.created_at','coalesce((p_snapshot->>''purchase_started_at'')::timestamptz,(p_snapshot->>''current_period_start'')::timestamptz)<i.created_at');
 source:=replace(source,'(p_snapshot->>''current_period_start'')::timestamptz>i.expires_at','coalesce((p_snapshot->>''purchase_started_at'')::timestamptz,(p_snapshot->>''current_period_start'')::timestamptz)>i.expires_at');
 execute source;
end $$;
