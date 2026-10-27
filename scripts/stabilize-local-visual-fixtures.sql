-- Local synthetic visual preparation only, never a production migration.
-- Preserve domain checks; only known tryout/athlete fixture timestamps may change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
create temporary table visual_tryout_before on commit drop as
  select id, to_jsonb(t) - 'updated_at' as row_value from public.tryouts t;
create temporary table visual_athlete_before on commit drop as
  select id, created_at, to_jsonb(a) - 'created_at' as row_value from public.athletes a;
create temporary table visual_athlete_order on commit drop as
  select ('29000000-0000-4000-8000-' || suffix)::uuid as id, given_name, family_name, sort_order
  from (values
    ('000000000061','Avery','Synthetic',0),
    ('000000000062','Blake','Synthetic',1),
    ('000000000063','Casey','Synthetic',2),
    ('000000000064','Dakota','Synthetic',3),
    ('000000000065','=Edge','Synthetic',4),
    ('000000000221','Avery','Converged',5),
    ('000000000222','Blake','Converged',6)
  ) fixture(suffix,given_name,family_name,sort_order);
do $guard$
begin
  if not exists(select 1 from public.organizations where id='29000000-0000-4000-8000-000000000001' and slug='badlands-hockey-academy')
    or (select count(*) from public.tryouts where organization_id='29000000-0000-4000-8000-000000000001'
      and ((id='29000000-0000-4000-8000-000000000032' and name='U15 Fall Evaluations')
        or (id='29000000-0000-4000-8000-000000000201' and name='U15 Converged Demo'))) <> 2 then
    raise exception 'Expected deterministic synthetic tryouts are missing';
  end if;
  if (select count(*) from visual_athlete_order f join public.athletes a
    on a.id=f.id and a.given_name=f.given_name and a.family_name=f.family_name
    and a.organization_id='29000000-0000-4000-8000-000000000001') <> 7 then
    raise exception 'Expected deterministic synthetic athletes are missing';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.athletes'::regclass
    and tgname='set_athletes_updated_at' and tgenabled='O') then
    raise exception 'Expected athlete timestamp trigger is not enabled';
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
-- Seed athletes share created_at, making a recent-athlete LIMIT nondeterministic.
-- Give only these seven fictional rows a strict order, retaining their displayed date.
alter table public.athletes disable trigger set_athletes_updated_at;
update public.athletes a
set created_at='2026-08-28 18:00:00+00'::timestamptz - f.sort_order * interval '1 second'
from visual_athlete_order f
where a.id=f.id and a.organization_id='29000000-0000-4000-8000-000000000001';
alter table public.athletes enable trigger set_athletes_updated_at;
do $verify$
begin
  if exists(select 1 from visual_athlete_before b full join public.athletes a using(id)
    where b.row_value is distinct from (to_jsonb(a) - 'created_at'))
    or exists(select 1 from visual_athlete_before b join public.athletes a using(id)
      where b.created_at is distinct from a.created_at
        and not exists(select 1 from visual_athlete_order f where f.id=a.id)) then
    raise exception 'Visual fixture preparation changed unrelated athlete fields';
  end if;
  if exists(select 1 from visual_athlete_order f join public.athletes a using(id)
    where a.created_at is distinct from '2026-08-28 18:00:00+00'::timestamptz - f.sort_order * interval '1 second')
    or not exists(select 1 from pg_trigger where tgrelid='public.athletes'::regclass
      and tgname='set_athletes_updated_at' and tgenabled='O') then
    raise exception 'Visual athlete order or timestamp trigger was not restored';
  end if;
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

-- Family visuals use only this known local synthetic athlete and the local demo identity.
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='demo.owner@badlands.example.test'),true);
insert into public.participant_links(organization_id,athlete_id,user_id,relationship)
select '29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000061',id,'guardian'
from auth.users where email='demo.owner@badlands.example.test' on conflict do nothing;
insert into public.scouting_records(id,organization_id,athlete_id,kind,title,body,status,visibility,strengths,development_areas,recommendation,created_by)
select '29fa0000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000061',
'report','Your tryout highlights','Avery brought energy, focus and strong communication to every session.','approved','athlete',
'Quick decisions and confident puck control','Keep scanning before receiving a pass','Practise shoulder checks at the next development session.',id
from auth.users where email='demo.owner@badlands.example.test' on conflict do nothing;
commit;
