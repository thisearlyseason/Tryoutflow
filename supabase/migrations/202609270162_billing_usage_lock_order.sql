-- Quota writers still serialize on the organization row. They do not change its key,
-- so NO KEY UPDATE retains that serialization without conflicting with the KEY SHARE
-- principal/FK locks held by concurrent membership and evaluator commands.
do $$
declare
  definition text;
  needle text := 'perform 1 from public.organizations where id=new.organization_id for update;';
begin
  select pg_get_functiondef('private.check_billing_usage()'::regprocedure) into definition;
  if position(needle in definition)=0 then
    raise exception 'billing_usage_lock_contract_changed';
  end if;
  execute replace(definition,needle,replace(needle,'for update;','for no key update;'));
end $$;
