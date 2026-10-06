-- Child writes must hold the event open through commit, but must not upgrade a shared
-- context lock to an exclusive parent lock after acquiring membership, evaluation or
-- roster locks. Two writers otherwise deadlock: the loser retains its shared event
-- lock while waiting for the winner's domain lock, and the winner waits to upgrade.
-- FOR SHARE permits concurrent child writers and still conflicts with completion,
-- sealing, deletion and root updates. Those operations retain their exclusive locks.
do $$
declare
  definition text;
  needle text;
begin
  select pg_get_functiondef('private.guard_single_tryout_write()'::regprocedure)
    into definition;
  needle := 'select t.status into status from public.tryouts t where t.organization_id=org and t.id=scope for update;';
  if position(needle in definition)=0 then
    raise exception 'single_tryout_write_guard_lock_contract_changed';
  end if;
  execute replace(definition,needle,replace(needle,'for update;','for share;'));

  select pg_get_functiondef('private.assert_single_tryout_writable(uuid,uuid)'::regprocedure)
    into definition;
  needle := 'select * into t from public.tryouts where organization_id=p_org and id=p_tryout for update;';
  if position(needle in definition)=0 then
    raise exception 'single_tryout_assert_lock_contract_changed';
  end if;
  execute replace(definition,needle,replace(needle,'for update;','for share;'));
end $$;
