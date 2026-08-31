-- A DISTINCT ON scan cannot stop at maxRows + 1 athletes until it has read
-- every earlier registration for duplicate-heavy athletes.  Keep only the
-- naturally unique tryout/athlete membership needed for candidate selection;
-- fetch latest registration truth after that population is bounded.
create table if not exists private.report_tryout_athlete_population (
  organization_id uuid not null,
  tryout_id uuid not null,
  athlete_id uuid not null,
  registration_count bigint not null,
  primary key (organization_id,tryout_id,athlete_id),
  constraint report_tryout_athlete_population_tryout_fkey
    foreign key (organization_id,tryout_id)
    references public.tryouts(organization_id,id) on delete cascade,
  constraint report_tryout_athlete_population_athlete_fkey
    foreign key (organization_id,athlete_id)
    references public.athletes(organization_id,id) on delete cascade,
  constraint report_tryout_athlete_population_count_check
    check (registration_count>=0)
);

alter table private.report_tryout_athlete_population enable row level security;
revoke all on table private.report_tryout_athlete_population
from public,anon,authenticated,service_role;

-- This is also the repair/replay primitive.  The write lock closes the gap
-- between recounting history and installing (or replacing) its triggers.
create or replace function private.rebuild_report_tryout_athlete_population()
returns bigint
language plpgsql volatile security definer set search_path='' as $$
declare population_count bigint;
begin
  lock table public.tryout_registrations in share row exclusive mode;

  insert into private.report_tryout_athlete_population(
    organization_id,tryout_id,athlete_id,registration_count
  )
  select registration.organization_id,registration.tryout_id,
    registration.athlete_id,count(*)
  from public.tryout_registrations registration
  group by registration.organization_id,registration.tryout_id,registration.athlete_id
  on conflict (organization_id,tryout_id,athlete_id) do update
    set registration_count=excluded.registration_count;

  delete from private.report_tryout_athlete_population population
  where not exists(
    select 1
    from public.tryout_registrations registration
    where registration.organization_id=population.organization_id
      and registration.tryout_id=population.tryout_id
      and registration.athlete_id=population.athlete_id
  );

  select count(*) into population_count
  from private.report_tryout_athlete_population;
  return population_count;
end;
$$;

select private.rebuild_report_tryout_athlete_population();

-- registration_count is the concurrency witness: inserts and deletes for one
-- natural key serialize on its primary-key row, so the last delete cannot
-- erase a membership established by a concurrent insert.
create or replace function private.maintain_report_tryout_athlete_population()
returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare remaining bigint;
begin
  if tg_op='INSERT' then
    insert into private.report_tryout_athlete_population(
      organization_id,tryout_id,athlete_id,registration_count
    ) values(new.organization_id,new.tryout_id,new.athlete_id,1)
    on conflict (organization_id,tryout_id,athlete_id) do update
      set registration_count=
        private.report_tryout_athlete_population.registration_count+1;
    return new;
  end if;

  if tg_op='DELETE' then
    update private.report_tryout_athlete_population population
    set registration_count=population.registration_count-1
    where population.organization_id=old.organization_id
      and population.tryout_id=old.tryout_id
      and population.athlete_id=old.athlete_id
      and population.registration_count>0
    returning registration_count into remaining;

    if found and remaining=0 then
      delete from private.report_tryout_athlete_population population
      where population.organization_id=old.organization_id
        and population.tryout_id=old.tryout_id
        and population.athlete_id=old.athlete_id
        and population.registration_count=0;
    elsif not found
      and exists(select 1 from public.tryouts target
        where target.organization_id=old.organization_id and target.id=old.tryout_id)
      and exists(select 1 from public.athletes athlete
        where athlete.organization_id=old.organization_id and athlete.id=old.athlete_id)
      and exists(select 1 from public.tryout_registrations registration
        where registration.organization_id=old.organization_id
          and registration.tryout_id=old.tryout_id
          and registration.athlete_id=old.athlete_id)
    then
      raise exception 'report tryout athlete population is inconsistent'
        using errcode='23514';
    end if;
    return old;
  end if;

  truncate table private.report_tryout_athlete_population;
  return null;
end;
$$;

-- Moving a registration would otherwise rewrite historical identity across
-- check-in, evaluation, roster, and report lineage.  Status and descriptive
-- registration corrections remain mutable and are reflected by latest truth.
create or replace function private.prevent_registration_identity_mutation()
returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  if row(old.organization_id,old.tryout_id,old.athlete_id)
    is distinct from row(new.organization_id,new.tryout_id,new.athlete_id)
  then
    raise exception 'registration organization, tryout, and athlete are immutable'
      using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists maintain_report_tryout_athlete_population_insert_delete
  on public.tryout_registrations;
create trigger maintain_report_tryout_athlete_population_insert_delete
after insert or delete on public.tryout_registrations
for each row execute function private.maintain_report_tryout_athlete_population();

drop trigger if exists maintain_report_tryout_athlete_population_truncate
  on public.tryout_registrations;
create trigger maintain_report_tryout_athlete_population_truncate
after truncate on public.tryout_registrations
for each statement execute function private.maintain_report_tryout_athlete_population();

drop trigger if exists prevent_registration_identity_mutation
  on public.tryout_registrations;
create trigger prevent_registration_identity_mutation
before update of organization_id,tryout_id,athlete_id
on public.tryout_registrations
for each row execute function private.prevent_registration_identity_mutation();

alter table public.tryout_registrations
  enable always trigger maintain_report_tryout_athlete_population_insert_delete;
alter table public.tryout_registrations
  enable always trigger maintain_report_tryout_athlete_population_truncate;
alter table public.tryout_registrations
  enable always trigger prevent_registration_identity_mutation;

create or replace function private.bounded_report_athlete_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(athlete_id uuid,registration_id uuid)
language sql stable security definer set search_path='' as $$
  with organization_candidates as materialized (
    select athlete.id athlete_id,registration.id registration_id
    from public.athletes athlete
    left join lateral (
      select registration.id
      from public.tryout_registrations registration
      where registration.organization_id=p_organization_id
        and registration.athlete_id=athlete.id
      order by registration.created_at desc,registration.id desc
      limit 1
    ) registration on true
    where p_tryout_id is null and athlete.organization_id=p_organization_id
    order by athlete.id
    limit (p_max_rows+1)
  ), bounded_tryout_population as materialized (
    select population.athlete_id
    from private.report_tryout_athlete_population population
    where p_tryout_id is not null
      and population.organization_id=p_organization_id
      and population.tryout_id=p_tryout_id
      and population.registration_count>0
    order by population.athlete_id
    limit (p_max_rows+1)
  ), tryout_candidates as materialized (
    select population.athlete_id,registration.id registration_id
    from bounded_tryout_population population
    join lateral (
      select registration.id
      from public.tryout_registrations registration
      where registration.organization_id=p_organization_id
        and registration.tryout_id=p_tryout_id
        and registration.athlete_id=population.athlete_id
      order by registration.created_at desc,registration.id desc
      limit 1
    ) registration on true
    order by population.athlete_id
  )
  select * from organization_candidates
  union all
  select * from tryout_candidates
  order by athlete_id;
$$;

revoke all on function
  private.rebuild_report_tryout_athlete_population(),
  private.maintain_report_tryout_athlete_population(),
  private.prevent_registration_identity_mutation(),
  private.bounded_report_athlete_candidates(uuid,uuid,integer)
from public,anon,authenticated,service_role;
