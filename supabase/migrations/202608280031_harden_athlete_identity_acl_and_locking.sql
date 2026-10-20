-- RLS governs row-level DML only. Supabase's table defaults also granted
-- TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN, so replace every Task 10/11
-- sensitive-table ACL with the exact application surface. Server writes use
-- owner-executed security-definer functions and need no service-role table ACL.
revoke all privileges on table
  public.athletes,
  public.guardians,
  public.athlete_guardians,
  public.tryout_registrations,
  public.session_enrollments,
  public.registration_duplicate_candidates,
  public.registration_confirmation_tokens,
  public.registration_rate_counters,
  public.athlete_import_previews
from public,anon,authenticated,service_role;

grant select on table
  public.athletes,
  public.guardians,
  public.athlete_guardians,
  public.tryout_registrations,
  public.session_enrollments,
  public.registration_duplicate_candidates,
  public.athlete_import_previews
to authenticated;

-- normalized_* is derived state, never caller-owned input. Repair historical
-- rows before adding equality constraints, then keep both a deriving trigger
-- and constraints so replication/trigger bypass cannot persist a lie.
update public.athletes set
  normalized_given_name=lower(public.canonical_import_text(given_name)),
  normalized_family_name=lower(public.canonical_import_text(family_name))
where normalized_given_name is distinct from lower(public.canonical_import_text(given_name))
   or normalized_family_name is distinct from lower(public.canonical_import_text(family_name));

alter table public.athletes
  add constraint athletes_normalized_given_name_canonical_check
    check(normalized_given_name=lower(public.canonical_import_text(given_name))) not valid,
  add constraint athletes_normalized_family_name_canonical_check
    check(normalized_family_name=lower(public.canonical_import_text(family_name))) not valid;
alter table public.athletes validate constraint athletes_normalized_given_name_canonical_check;
alter table public.athletes validate constraint athletes_normalized_family_name_canonical_check;

create function public.canonicalize_athlete_identity_fields()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  new.normalized_given_name:=lower(public.canonical_import_text(new.given_name));
  new.normalized_family_name:=lower(public.canonical_import_text(new.family_name));
  return new;
end;
$$;

create trigger canonicalize_athlete_identity_fields
before insert or update of given_name,family_name,normalized_given_name,normalized_family_name
on public.athletes
for each row execute function public.canonicalize_athlete_identity_fields();

-- Hash an unambiguous JSON array of typed canonical fields, not a delimited
-- string. SHA-256 is truncated to PostgreSQL's signed 64-bit advisory-key
-- space. A theoretical 64-bit collision only causes extra serialization: all
-- duplicate decisions still compare the complete relational identity.
create function public.canonical_athlete_identity_lock_key(
  p_organization_id uuid,
  p_given_name text,
  p_family_name text,
  p_birth_date date
)
returns bigint
language sql
immutable
strict
security definer
set search_path=''
as $$
  select (
    'x'||substr(
      encode(
        extensions.digest(
          convert_to(
            jsonb_build_array(
              p_organization_id::text,
              lower(public.canonical_import_text(p_given_name)),
              lower(public.canonical_import_text(p_family_name)),
              p_birth_date-date '2000-01-01'
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      1,16
    )
  )::bit(64)::bigint
$$;

create or replace function public.lock_canonical_athlete_identity(
  p_organization_id uuid,
  p_given_name text,
  p_family_name text,
  p_birth_date date
)
returns void
language plpgsql
set search_path=''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    public.canonical_athlete_identity_lock_key(
      p_organization_id,p_given_name,p_family_name,p_birth_date
    )
  );
end;
$$;

-- Keep the fully validated Task 11 transaction intact behind an internal name.
-- The public wrapper locks every selected identity by the actual signed bigint
-- key first. The internal transaction's row trigger/legacy pre-lock loop can
-- only re-enter locks already held, so inverse batches cannot form a cycle.
alter function public.commit_athlete_import(uuid,uuid,integer[])
  rename to commit_athlete_import_after_identity_locks;

revoke all on function public.commit_athlete_import_after_identity_locks(uuid,uuid,integer[])
from public,anon,authenticated,service_role;

create function public.commit_athlete_import(
  p_organization_id uuid,
  p_preview_id uuid,
  p_selected_rows integer[]
)
returns table(outcome text,athlete_ids uuid[])
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.athlete_import_previews%rowtype;
  sorted_rows integer[];
  v_lock_key bigint;
begin
  if auth.uid() is null
    or not public.is_active_organization_member(
      p_organization_id,array['owner','administrator']
    ) then
    raise exception 'athlete import forbidden' using errcode='42501';
  end if;

  if p_selected_rows is not null
    and cardinality(p_selected_rows) between 1 and 500
    and not exists(select 1 from unnest(p_selected_rows) row_number where row_number<2)
    and (select count(*) from unnest(p_selected_rows))
      =(select count(distinct row_number) from unnest(p_selected_rows) row_number)
  then
    select array_agg(row_number order by row_number)
    into sorted_rows from unnest(p_selected_rows) row_number;
  end if;

  select * into target from public.athlete_import_previews
  where organization_id=p_organization_id and id=p_preview_id
  for update;

  if found and target.actor_user_id<>auth.uid() then
    raise exception 'athlete import actor mismatch' using errcode='42501';
  end if;

  if found
    and target.committed_at is null
    and target.expires_at>clock_timestamp()
    and sorted_rows is not null
    and (
      select count(*) from jsonb_array_elements(target.preview_rows) preview_row
      where (preview_row->>'row')::integer=any(sorted_rows)
        and preview_row->>'status'='valid'
    )=cardinality(sorted_rows)
  then
    for v_lock_key in
      select distinct public.canonical_athlete_identity_lock_key(
        p_organization_id,
        preview_row->'athlete'->>'givenName',
        preview_row->'athlete'->>'familyName',
        case
          when public.is_valid_registration_calendar_date(
            public.canonical_import_text(preview_row->'athlete'->>'birthDate')
          ) then public.canonical_import_text(preview_row->'athlete'->>'birthDate')::date
          else date '0001-01-01'
        end
      ) as lock_key
      from jsonb_array_elements(target.preview_rows) preview_row
      where (preview_row->>'row')::integer=any(sorted_rows)
      order by lock_key
    loop
      perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
    end loop;
  end if;

  return query
    select * from public.commit_athlete_import_after_identity_locks(
      p_organization_id,p_preview_id,p_selected_rows
    );
end;
$$;

revoke all on function
  public.canonicalize_athlete_identity_fields(),
  public.canonical_athlete_identity_lock_key(uuid,text,text,date),
  public.lock_canonical_athlete_identity(uuid,text,text,date),
  public.lock_athlete_identity_before_insert(),
  public.commit_athlete_import(uuid,uuid,integer[]),
  public.commit_athlete_import_after_identity_locks(uuid,uuid,integer[])
from public,anon,authenticated,service_role;

grant execute on function
  public.canonicalize_athlete_identity_fields(),
  public.canonical_athlete_identity_lock_key(uuid,text,text,date),
  public.lock_canonical_athlete_identity(uuid,text,text,date),
  public.lock_athlete_identity_before_insert(),
  public.commit_athlete_import_after_identity_locks(uuid,uuid,integer[])
to postgres;

grant execute on function public.commit_athlete_import(uuid,uuid,integer[])
to authenticated;
