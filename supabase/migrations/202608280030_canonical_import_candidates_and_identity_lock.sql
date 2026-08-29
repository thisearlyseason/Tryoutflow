-- Make athlete identity serialization and CSV candidate membership one shared
-- database contract. Candidate identifiers are ASCII UUIDs or
-- preview-row:<integer>, ordered with the C collation to match the TypeScript
-- wire representation.

create function public.lock_canonical_athlete_identity(
  p_organization_id uuid,
  p_given_name text,
  p_family_name text,
  p_birth_date date
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat_ws('|', p_organization_id::text,
        lower(public.canonical_import_text(p_given_name)),
        lower(public.canonical_import_text(p_family_name)),
        p_birth_date::text),
      0
    )
  );
end;
$$;

create function public.lock_athlete_identity_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_canonical_athlete_identity(
    new.organization_id, new.given_name, new.family_name, new.birth_date
  );
  return new;
end;
$$;

create trigger lock_athlete_identity_before_insert
before insert on public.athletes
for each row execute function public.lock_athlete_identity_before_insert();

revoke all on function public.lock_canonical_athlete_identity(uuid,text,text,date),
  public.lock_athlete_identity_before_insert()
from public,anon,authenticated,service_role;
grant execute on function public.lock_canonical_athlete_identity(uuid,text,text,date),
  public.lock_athlete_identity_before_insert()
to postgres;

create or replace function public.current_athlete_import_candidate_ids(
  p_organization_id uuid,
  p_preview_rows jsonb,
  p_row integer
)
returns jsonb
language sql stable set search_path='' as $$
  with target as (
    select row_item,
      lower(public.canonical_import_text(row_item->'athlete'->>'givenName')) as given_name,
      lower(public.canonical_import_text(row_item->'athlete'->>'familyName')) as family_name,
      public.canonical_import_text(row_item->'athlete'->>'birthDate') as birth_date
    from jsonb_array_elements(p_preview_rows) row_item
    where (row_item->>'row')::integer=p_row
  ), candidates as (
    select athlete.id::text as candidate_id
    from target
    join public.athletes athlete on athlete.organization_id=p_organization_id
      and normalize(athlete.normalized_given_name,NFC)=target.given_name
      and normalize(athlete.normalized_family_name,NFC)=target.family_name
      and athlete.birth_date=target.birth_date::date
    union
    select 'preview-row:'||(prior->>'row')
    from target
    cross join jsonb_array_elements(p_preview_rows) prior
    where (prior->>'row')::integer < p_row
      and prior->>'status' in ('valid','duplicate_candidate')
      and jsonb_typeof(prior->'errors')='array'
      and jsonb_array_length(prior->'errors')=0
      and lower(public.canonical_import_text(prior->'athlete'->>'givenName'))=target.given_name
      and lower(public.canonical_import_text(prior->'athlete'->>'familyName'))=target.family_name
      and public.canonical_import_text(prior->'athlete'->>'birthDate')=target.birth_date
  )
  select coalesce(
    jsonb_agg(to_jsonb(candidate_id) order by candidate_id collate "C"),
    '[]'::jsonb
  )
  from candidates
$$;

revoke all on function public.current_athlete_import_candidate_ids(uuid,jsonb,integer)
from public,anon,authenticated,service_role;

create or replace function public.resolve_athlete_import_duplicate(
  p_organization_id uuid,
  p_preview_id uuid,
  p_row integer,
  p_decision text
)
returns table(outcome text)
language plpgsql security definer set search_path='' as $$
declare
  target public.athlete_import_previews%rowtype;
  item jsonb;
  candidate_ids jsonb;
  row_digest text;
  decision_record jsonb;
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
    raise exception 'athlete import forbidden' using errcode='42501';
  end if;
  if p_decision <> 'keep_separate' or p_row < 2 then
    return query select 'invalid_decision'::text; return;
  end if;
  select * into target from public.athlete_import_previews
  where organization_id=p_organization_id and id=p_preview_id for update;
  if not found or target.actor_user_id <> auth.uid() then
    raise exception 'athlete import forbidden' using errcode='42501';
  end if;
  if target.expires_at <= clock_timestamp() then return query select 'expired'::text; return; end if;
  if target.committed_at is not null then return query select 'conflict'::text; return; end if;
  select row_item into item from jsonb_array_elements(target.preview_rows) row_item
  where (row_item->>'row')::integer=p_row;
  if item is null or item->>'status' <> 'duplicate_candidate'
    or jsonb_array_length(item->'errors') <> 0
    or public.is_valid_registration_calendar_date(
      public.canonical_import_text(item->'athlete'->>'birthDate')
    ) is not true then
    return query select 'invalid_decision'::text; return;
  end if;

  perform public.lock_canonical_athlete_identity(
    p_organization_id,
    item->'athlete'->>'givenName',
    item->'athlete'->>'familyName',
    public.canonical_import_text(item->'athlete'->>'birthDate')::date
  );
  candidate_ids := public.current_athlete_import_candidate_ids(p_organization_id,target.preview_rows,p_row);
  if jsonb_array_length(candidate_ids)=0
    or item->'duplicateCandidateIds' is distinct from candidate_ids then
    return query select 'invalid_decision'::text; return;
  end if;
  row_digest := encode(extensions.digest((item->'athlete')::text,'sha256'),'hex');
  decision_record := jsonb_build_object(
    'decision','keep_separate','candidateIds',candidate_ids,'rowDigest',row_digest
  );
  update public.athlete_import_previews set
    duplicate_decisions=jsonb_set(duplicate_decisions,array[p_row::text],decision_record,true),
    preview_rows=(
      select jsonb_agg(
        case when (row_item->>'row')::integer=p_row
          then jsonb_set(row_item,'{status}','"valid"'::jsonb,false)
          else row_item end order by (row_item->>'row')::integer
      ) from jsonb_array_elements(preview_rows) row_item
    )
  where id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
  values(p_organization_id,auth.uid(),'athlete_import_duplicate.kept_separate','athlete_import',target.id);
  return query select 'resolved'::text;
end;
$$;

create or replace function public.commit_athlete_import(
  p_organization_id uuid,
  p_preview_id uuid,
  p_selected_rows integer[]
)
returns table(outcome text, athlete_ids uuid[])
language plpgsql security definer set search_path='' as $$
declare
  target public.athlete_import_previews%rowtype;
  sorted_rows integer[]; requested_digest text; item jsonb; identity jsonb; v_row integer;
  v_given_name text; v_family_name text; v_birth_date_text text;
  v_guardian_name text; v_guardian_email text; v_guardian_phone text;
  v_decision jsonb; v_candidate_ids jsonb; v_row_digest text;
  v_identity record;
  created_athlete uuid; created_guardian uuid; created_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
    raise exception 'athlete import forbidden' using errcode='42501';
  end if;
  if p_selected_rows is null or cardinality(p_selected_rows) not between 1 and 500
    or exists(select 1 from unnest(p_selected_rows) n where n < 2)
    or (select count(*) from unnest(p_selected_rows))<>(select count(distinct n) from unnest(p_selected_rows) n)
  then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;
  select array_agg(n order by n) into sorted_rows from unnest(p_selected_rows) n;
  requested_digest := encode(extensions.digest(array_to_string(sorted_rows,','),'sha256'),'hex');
  select * into target from public.athlete_import_previews
  where organization_id=p_organization_id and id=p_preview_id for update;
  if not found then raise exception 'athlete import forbidden' using errcode='42501'; end if;
  if target.actor_user_id<>auth.uid() then raise exception 'athlete import actor mismatch' using errcode='42501'; end if;
  if target.committed_at is not null then
    if target.selection_digest=requested_digest then return query select 'replayed'::text,target.result_athlete_ids;
    else return query select 'conflict'::text,array[]::uuid[]; end if; return;
  end if;
  if target.expires_at<=clock_timestamp() then return query select 'expired'::text,array[]::uuid[]; return; end if;
  if (select count(*) from jsonb_array_elements(target.preview_rows) r
      where (r->>'row')::integer=any(sorted_rows) and r->>'status'='valid')<>cardinality(sorted_rows)
  then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;

  -- Acquire every identity in canonical text order before any duplicate lookup.
  -- The athletes trigger uses this same primitive for registration and all
  -- future direct athlete creation paths.
  for v_identity in
    select candidate_identity.given_name,candidate_identity.family_name,candidate_identity.birth_date
    from (
      select distinct
        lower(public.canonical_import_text(r->'athlete'->>'givenName')) as given_name,
        lower(public.canonical_import_text(r->'athlete'->>'familyName')) as family_name,
        case
          when public.is_valid_registration_calendar_date(public.canonical_import_text(r->'athlete'->>'birthDate'))
            then public.canonical_import_text(r->'athlete'->>'birthDate')::date
          else date '0001-01-01'
        end as birth_date
      from jsonb_array_elements(target.preview_rows) r
      where (r->>'row')::integer=any(sorted_rows)
    ) candidate_identity
    order by candidate_identity.given_name collate "C",
      candidate_identity.family_name collate "C",candidate_identity.birth_date
  loop
    perform public.lock_canonical_athlete_identity(
      p_organization_id,v_identity.given_name,v_identity.family_name,v_identity.birth_date
    );
  end loop;

  for item in select r from jsonb_array_elements(target.preview_rows) r
    where (r->>'row')::integer=any(sorted_rows) order by (r->>'row')::integer
  loop
    identity:=item->'athlete'; v_row:=(item->>'row')::integer;
    if jsonb_typeof(identity->'givenName') is distinct from 'string'
      or jsonb_typeof(identity->'familyName') is distinct from 'string'
      or jsonb_typeof(identity->'birthDate') is distinct from 'string'
      or (identity ? 'guardianName' and jsonb_typeof(identity->'guardianName') is distinct from 'string')
      or (identity ? 'guardianEmail' and jsonb_typeof(identity->'guardianEmail') is distinct from 'string')
      or (identity ? 'guardianPhone' and jsonb_typeof(identity->'guardianPhone') is distinct from 'string')
      or (identity ? 'guardianName')<>(identity ? 'guardianEmail')
    then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;
    v_given_name:=public.canonical_import_text(identity->>'givenName');
    v_family_name:=public.canonical_import_text(identity->>'familyName');
    v_birth_date_text:=public.canonical_import_text(identity->>'birthDate');
    v_guardian_name:=case when identity ? 'guardianName' then public.canonical_import_text(identity->>'guardianName') end;
    v_guardian_email:=case when identity ? 'guardianEmail' then lower(public.canonical_import_text(identity->>'guardianEmail')) end;
    v_guardian_phone:=case when identity ? 'guardianPhone' then public.canonical_import_text(identity->>'guardianPhone') end;
    if char_length(v_given_name) not between 1 and 120 or char_length(v_family_name) not between 1 and 120
      or not public.is_valid_registration_calendar_date(v_birth_date_text) or v_birth_date_text::date>current_date
      or (v_guardian_name is not null and char_length(v_guardian_name) not between 1 and 160)
      or (v_guardian_email is not null and not public.is_valid_registration_email(v_guardian_email))
      or (v_guardian_phone is not null and not public.is_valid_registration_phone(v_guardian_phone))
      or (v_guardian_phone is not null and v_guardian_email is null)
    then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;

    v_candidate_ids:=public.current_athlete_import_candidate_ids(p_organization_id,target.preview_rows,v_row);
    v_decision:=target.duplicate_decisions->v_row::text;
    v_row_digest:=encode(extensions.digest(identity::text,'sha256'),'hex');

    -- A decision authorizes exactly one row digest and one candidate array.
    -- Compare it even when the recomputed set is empty. The first call records
    -- the stale transition and returns without inserting; a valid/empty row can
    -- be selected again without a duplicate decision on the next request.
    if v_decision is not null and (
      v_decision->>'decision' is distinct from 'keep_separate'
      or v_decision->>'rowDigest' is distinct from v_row_digest
      or v_decision->'candidateIds' is distinct from v_candidate_ids
    ) then
      update public.athlete_import_previews set
        duplicate_decisions=duplicate_decisions-v_row::text,
        preview_rows=(select jsonb_agg(
          case when (r->>'row')::integer=v_row then
            jsonb_set(
              jsonb_set(r,'{status}',to_jsonb(
                case when jsonb_array_length(v_candidate_ids)>0 then 'duplicate_candidate' else 'valid' end
              ),false),
              '{duplicateCandidateIds}',v_candidate_ids,false
            )
          else r end order by (r->>'row')::integer
        ) from jsonb_array_elements(preview_rows) r)
      where id=target.id;
      return query select 'invalid_selection'::text,array[]::uuid[]; return;
    end if;
    if jsonb_array_length(v_candidate_ids)>0 and v_decision is null then
      update public.athlete_import_previews set
        duplicate_decisions=duplicate_decisions-v_row::text,
        preview_rows=(select jsonb_agg(
          case when (r->>'row')::integer=v_row then
            jsonb_set(jsonb_set(r,'{status}',to_jsonb('duplicate_candidate'::text),false),'{duplicateCandidateIds}',v_candidate_ids,false)
          else r end order by (r->>'row')::integer
        ) from jsonb_array_elements(preview_rows) r)
      where id=target.id;
      return query select 'invalid_selection'::text,array[]::uuid[]; return;
    end if;
  end loop;

  for item in select r from jsonb_array_elements(target.preview_rows) r
    where (r->>'row')::integer=any(sorted_rows) order by (r->>'row')::integer
  loop
    identity:=item->'athlete';
    v_given_name:=public.canonical_import_text(identity->>'givenName');
    v_family_name:=public.canonical_import_text(identity->>'familyName');
    v_birth_date_text:=public.canonical_import_text(identity->>'birthDate');
    v_guardian_name:=case when identity ? 'guardianName' then public.canonical_import_text(identity->>'guardianName') end;
    v_guardian_email:=case when identity ? 'guardianEmail' then lower(public.canonical_import_text(identity->>'guardianEmail')) end;
    v_guardian_phone:=case when identity ? 'guardianPhone' then public.canonical_import_text(identity->>'guardianPhone') end;
    insert into public.athletes(organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
    values(p_organization_id,v_given_name,v_family_name,lower(v_given_name),lower(v_family_name),v_birth_date_text::date)
    returning id into created_athlete;
    created_ids:=array_append(created_ids,created_athlete);
    if v_guardian_email is not null then
      insert into public.guardians(organization_id,name,email,normalized_email,phone)
      values(p_organization_id,v_guardian_name,v_guardian_email,v_guardian_email,v_guardian_phone) returning id into created_guardian;
      insert into public.athlete_guardians(organization_id,athlete_id,guardian_id)
      values(p_organization_id,created_athlete,created_guardian);
    end if;
  end loop;
  update public.athlete_import_previews set committed_at=clock_timestamp(),selection_digest=requested_digest,result_athlete_ids=created_ids where id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
  values(p_organization_id,auth.uid(),'athletes.imported','athlete_import',target.id);
  return query select 'committed'::text,created_ids;
end;
$$;

revoke all on function public.resolve_athlete_import_duplicate(uuid,uuid,integer,text),
  public.commit_athlete_import(uuid,uuid,integer[])
from public,anon,authenticated,service_role;
grant execute on function public.resolve_athlete_import_duplicate(uuid,uuid,integer,text),
  public.commit_athlete_import(uuid,uuid,integer[])
to authenticated;
