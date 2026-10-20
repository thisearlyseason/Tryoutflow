-- Local synthetic visual preparation only, never a production migration.
-- Preserve domain checks and all row fields except the two fixture timestamps.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
create temporary table visual_tryout_before on commit drop as
  select id, to_jsonb(t) - 'updated_at' as row_value from public.tryouts t;
do $guard$
begin
  if not exists(select 1 from public.organizations where id='29000000-0000-4000-8000-000000000001' and slug='badlands-hockey-academy')
    or (select count(*) from public.tryouts where organization_id='29000000-0000-4000-8000-000000000001'
      and ((id='29000000-0000-4000-8000-000000000032' and name='U15 Fall Evaluations')
        or (id='29000000-0000-4000-8000-000000000201' and name='U15 Converged Demo'))) <> 2 then
    raise exception 'Expected deterministic synthetic tryouts are missing';
  end if;
  if (select count(*) from pg_trigger where tgrelid='public.tryouts'::regclass
    and tgname in ('set_tryouts_updated_at','a_increment_tryout_version') and tgenabled='O') <> 2 then
    raise exception 'Expected timestamp/version fixture triggers are not enabled';
  end if;
end;
$guard$;
-- Publishing seed rows invokes the wall-clock touch/version triggers. Freeze
-- timestamps for repeatable screenshots without changing their domain versions.
alter table public.tryouts disable trigger set_tryouts_updated_at;
alter table public.tryouts disable trigger a_increment_tryout_version;
update public.tryouts set updated_at='2026-08-28 18:05:00+00'
where organization_id='29000000-0000-4000-8000-000000000001'
  and id in ('29000000-0000-4000-8000-000000000032','29000000-0000-4000-8000-000000000201');
alter table public.tryouts enable trigger a_increment_tryout_version;
alter table public.tryouts enable trigger set_tryouts_updated_at;
do $verify$
begin
  if exists(select 1 from visual_tryout_before b full join public.tryouts t using(id)
    where b.row_value is distinct from (to_jsonb(t) - 'updated_at')) then
    raise exception 'Visual fixture preparation changed fields other than updated_at';
  end if;
  if (select count(*) from pg_trigger where tgrelid='public.tryouts'::regclass
    and tgname in ('set_tryouts_updated_at','a_increment_tryout_version') and tgenabled='O') <> 2 then
    raise exception 'Visual fixture triggers were not restored';
  end if;
end;
$verify$;
commit;
