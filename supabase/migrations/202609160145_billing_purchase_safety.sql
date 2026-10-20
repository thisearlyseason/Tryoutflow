-- Once an organization adopts v2 billing, legacy checkout cannot create a competing contract.
do $$ declare source text; begin
 select pg_get_functiondef('public.reserve_subscription_checkout_intent(uuid,uuid,text,uuid)'::regprocedure) into source;
 source:=replace(source,$old$and c.environment=(select environment from private.billing_configuration) and c.status in ('active','trialing','grace_period','past_due','cancelled','incomplete')
    and (c.current_period_end is null or greatest(c.current_period_end,c.grace_period_end)>now())$old$,
 $new$and c.environment=(select environment from private.billing_configuration)$new$);
 execute source;
 select pg_get_functiondef('public.reserve_billing_purchase(uuid,uuid,uuid,text,text)'::regprocedure) into source;
 source:=replace(source,$old$'active','trialing','grace_period','past_due','cancelled','incomplete'$old$,$new$'active','trialing','grace_period','past_due','cancelled','incomplete','paused','refunded'$new$);
 source:=replace(source,$old$'active','trialing','past_due','grace_period','cancelled'$old$,$new$'active','trialing','past_due','grace_period','cancelled','paused','refunded'$new$);
 source:=replace(source,' select environment into env from private.billing_configuration;',
 $new$ if p_provider in ('apple','google') then
  perform pg_advisory_xact_lock(hashtextextended('native-purchaser:'||auth.uid()::text,0));
  if exists(select 1 from private.billing_purchase_intents where purchaser_id=auth.uid() and organization_id<>p_organization_id and provider in ('apple','google') and expires_at>now() and contract_id is null) then raise exception 'purchase_in_progress'; end if;
 end if;
 select environment into env from private.billing_configuration;$new$);
 execute source;
end $$;
