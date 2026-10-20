-- Legacy subscriptions retain the pre-existing verified-state contract during migration.
-- Only v2 contracts use the new temporal resolver; do not strand existing paid accounts
-- in a Free screen while their old Stripe subscription remains active.
do $$ declare source text; begin
 select pg_get_functiondef('private.effective_billing_access(uuid,uuid)'::regprocedure) into source;
 source:=replace(source,' and (a.current_period_end is null or a.current_period_end>now())','');
 execute source;
end $$;
