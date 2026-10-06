-- Configuration mutations need the exclusive event lock used by publication.
-- Acquire it before the single-event guard's shared lock to avoid concurrent
-- configuration writers both attempting a SHARE -> UPDATE upgrade.
-- Trigger order is lexical; preserve both guards and their existing strength.
do $$
declare t record;
begin
 for t in select n.nspname, c.relname, g.tgname
  from pg_trigger g
  join pg_class c on c.oid=g.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where not g.tgisinternal
    and g.tgfoid='public.lock_tryout_root_for_configuration()'::regprocedure
 loop
  if t.tgname like 'aa_lock_tryout_root_%' then
   execute format('alter trigger %I on %I.%I rename to %I',
    t.tgname,t.nspname,t.relname,'a0_'||substring(t.tgname from 4));
  end if;
 end loop;
end $$;
