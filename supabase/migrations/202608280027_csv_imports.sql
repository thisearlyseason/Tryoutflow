-- Staff CSV imports use a short-lived, actor-bound review artifact. The raw CSV
-- is never persisted: only its SHA-256 digest, explicit mapping, and validated
-- row projection are retained for the confirmation transaction.
create table public.athlete_import_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  source_digest text not null,
  column_mapping jsonb not null,
  preview_rows jsonb not null,
  expires_at timestamptz not null,
  committed_at timestamptz,
  selection_digest text,
  result_athlete_ids uuid[],
  created_at timestamptz not null default clock_timestamp(),
  constraint athlete_import_previews_organization_id_id_key unique(organization_id,id),
  constraint athlete_import_previews_source_digest_check check(source_digest ~ '^[0-9a-f]{64}$'),
  constraint athlete_import_previews_mapping_object_check check(jsonb_typeof(column_mapping)='object'),
  constraint athlete_import_previews_rows_check check(jsonb_typeof(preview_rows)='array' and jsonb_array_length(preview_rows) between 1 and 1000),
  constraint athlete_import_previews_expiry_check check(expires_at > created_at and expires_at <= created_at + interval '31 minutes'),
  constraint athlete_import_previews_commit_shape_check check(
    (committed_at is null and selection_digest is null and result_athlete_ids is null)
    or (committed_at is not null and selection_digest ~ '^[0-9a-f]{64}$' and result_athlete_ids is not null)
  )
);
create index athlete_import_previews_expiry_idx on public.athlete_import_previews(expires_at);
create index athlete_import_previews_actor_idx on public.athlete_import_previews(organization_id,actor_user_id,created_at desc);
alter table public.athlete_import_previews enable row level security;

create policy athlete_import_previews_select_administrators
on public.athlete_import_previews for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));

revoke all on table public.athlete_import_previews from public,anon,authenticated;
grant select on table public.athlete_import_previews to authenticated;

create function public.create_athlete_import_preview(
  p_organization_id uuid,
  p_source_digest text,
  p_column_mapping jsonb,
  p_preview_rows jsonb
)
returns table(preview_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare
  created_id uuid;
  created_expiry timestamptz := clock_timestamp() + interval '30 minutes';
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
    raise exception 'athlete import forbidden' using errcode='42501';
  end if;
  if p_source_digest !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_column_mapping) is distinct from 'object'
    or octet_length(p_column_mapping::text) > 4096
    or jsonb_typeof(p_preview_rows) is distinct from 'array'
    or octet_length(p_preview_rows::text) > 2097152
    or jsonb_array_length(p_preview_rows) not between 1 and 1000
    or not (p_column_mapping ?& array['givenName','familyName','birthDate'])
    or exists(
      select 1 from jsonb_each(p_column_mapping) mapping_entry
      where mapping_entry.key not in ('givenName','familyName','birthDate','guardianName','guardianEmail','guardianPhone')
        or jsonb_typeof(mapping_entry.value) <> 'string'
        or public.canonical_registration_text(mapping_entry.value #>> '{}') = ''
    )
    or (select count(*) from jsonb_array_elements(p_preview_rows)) <>
      (select count(distinct (row_item->>'row')::integer) from jsonb_array_elements(p_preview_rows) row_item)
    or exists(
      select 1 from jsonb_array_elements(p_preview_rows) item
      where jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'row') <> 'number'
        or (item->>'row')::integer < 2
        or item->>'status' not in ('valid','duplicate_candidate','invalid')
        or jsonb_typeof(item->'errors') <> 'array'
        or jsonb_typeof(item->'athlete') <> 'object'
        or jsonb_typeof(item->'duplicateCandidateIds') <> 'array'
        or exists(select 1 from jsonb_object_keys(item) key where key not in ('row','status','errors','athlete','duplicateCandidateIds'))
        or exists(select 1 from jsonb_object_keys(item->'athlete') key where key not in ('givenName','familyName','birthDate','guardianName','guardianEmail','guardianPhone'))
        or jsonb_typeof(item->'athlete'->'givenName') <> 'string'
        or jsonb_typeof(item->'athlete'->'familyName') <> 'string'
        or jsonb_typeof(item->'athlete'->'birthDate') <> 'string'
        or exists(select 1 from jsonb_array_elements(item->'errors') error_item where jsonb_typeof(error_item) <> 'string')
        or exists(select 1 from jsonb_array_elements(item->'duplicateCandidateIds') candidate where jsonb_typeof(candidate) <> 'string')
    )
  then
    raise exception 'invalid athlete import preview' using errcode='22023';
  end if;

  with expired as (
    select old_preview.id from public.athlete_import_previews old_preview
    where old_preview.expires_at <= clock_timestamp()
    order by old_preview.expires_at limit 100
  )
  delete from public.athlete_import_previews target using expired where target.id=expired.id;

  insert into public.athlete_import_previews(
    organization_id,actor_user_id,source_digest,column_mapping,preview_rows,expires_at
  ) values (
    p_organization_id,auth.uid(),p_source_digest,p_column_mapping,p_preview_rows,created_expiry
  ) returning id into created_id;
  return query select created_id,created_expiry;
end;
$$;

create function public.commit_athlete_import(
  p_organization_id uuid,
  p_preview_id uuid,
  p_selected_rows integer[]
)
returns table(outcome text, athlete_ids uuid[])
language plpgsql security definer set search_path='' as $$
declare
  target public.athlete_import_previews%rowtype;
  sorted_rows integer[];
  requested_digest text;
  item jsonb;
  identity jsonb;
  v_given_name text;
  v_family_name text;
  v_birth_date_text text;
  v_guardian_name text;
  v_guardian_email text;
  v_guardian_phone text;
  created_athlete uuid;
  created_guardian uuid;
  created_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
    raise exception 'athlete import forbidden' using errcode='42501';
  end if;
  if p_selected_rows is null or cardinality(p_selected_rows) not between 1 and 500
    or exists(select 1 from unnest(p_selected_rows) row_number where row_number < 2)
    or (select count(*) from unnest(p_selected_rows)) <> (select count(distinct row_number) from unnest(p_selected_rows) row_number)
  then
    return query select 'invalid_selection'::text,array[]::uuid[];
    return;
  end if;
  select array_agg(row_number order by row_number) into sorted_rows from unnest(p_selected_rows) row_number;
  requested_digest := encode(extensions.digest(array_to_string(sorted_rows,','),'sha256'),'hex');

  select * into target from public.athlete_import_previews
  where organization_id=p_organization_id and id=p_preview_id for update;
  if not found then
    raise exception 'athlete import forbidden' using errcode='42501';
  end if;
  if target.actor_user_id <> auth.uid() then
    raise exception 'athlete import actor mismatch' using errcode='42501';
  end if;
  if target.committed_at is not null then
    if target.selection_digest=requested_digest then
      return query select 'replayed'::text,target.result_athlete_ids;
    else
      return query select 'conflict'::text,array[]::uuid[];
    end if;
    return;
  end if;
  if target.expires_at <= clock_timestamp() then
    return query select 'expired'::text,array[]::uuid[];
    return;
  end if;
  if (
    select count(*) from jsonb_array_elements(target.preview_rows) row_item
    where (row_item->>'row')::integer=any(sorted_rows) and row_item->>'status'='valid'
  ) <> cardinality(sorted_rows) then
    return query select 'invalid_selection'::text,array[]::uuid[];
    return;
  end if;

  -- First pass revalidates every selected row and checks current duplicate state
  -- before the transaction performs any insert.
  for item in
    select row_item from jsonb_array_elements(target.preview_rows) row_item
    where (row_item->>'row')::integer=any(sorted_rows)
    order by (row_item->>'row')::integer
  loop
    identity := item->'athlete';
    if jsonb_typeof(identity->'givenName') is distinct from 'string'
      or jsonb_typeof(identity->'familyName') is distinct from 'string'
      or jsonb_typeof(identity->'birthDate') is distinct from 'string'
      or (identity ? 'guardianName' and jsonb_typeof(identity->'guardianName') is distinct from 'string')
      or (identity ? 'guardianEmail' and jsonb_typeof(identity->'guardianEmail') is distinct from 'string')
      or (identity ? 'guardianPhone' and jsonb_typeof(identity->'guardianPhone') is distinct from 'string')
      or (identity ? 'guardianName') <> (identity ? 'guardianEmail')
    then
      return query select 'invalid_selection'::text,array[]::uuid[]; return;
    end if;
    v_given_name := public.canonical_registration_text(identity->>'givenName');
    v_family_name := public.canonical_registration_text(identity->>'familyName');
    v_birth_date_text := identity->>'birthDate';
    v_guardian_name := case when identity ? 'guardianName' then public.canonical_registration_text(identity->>'guardianName') end;
    v_guardian_email := case when identity ? 'guardianEmail' then lower(public.canonical_registration_text(identity->>'guardianEmail')) end;
    v_guardian_phone := case when identity ? 'guardianPhone' then public.canonical_registration_text(identity->>'guardianPhone') end;
    if char_length(v_given_name) not between 1 and 120
      or char_length(v_family_name) not between 1 and 120
      or not public.is_valid_registration_calendar_date(v_birth_date_text)
      or v_birth_date_text::date > current_date
      or (v_guardian_name is not null and char_length(v_guardian_name) not between 1 and 160)
      or (v_guardian_email is not null and not public.is_valid_registration_email(v_guardian_email))
      or (v_guardian_phone is not null and not public.is_valid_registration_phone(v_guardian_phone))
      or (v_guardian_phone is not null and v_guardian_email is null)
    then
      return query select 'invalid_selection'::text,array[]::uuid[]; return;
    end if;
    if v_guardian_email is not null and exists(
      select 1 from public.athletes athlete
      join public.athlete_guardians link on link.organization_id=athlete.organization_id and link.athlete_id=athlete.id
      join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
      where athlete.organization_id=p_organization_id
        and athlete.normalized_given_name=lower(v_given_name)
        and athlete.normalized_family_name=lower(v_family_name)
        and athlete.birth_date=v_birth_date_text::date
        and guardian.normalized_email=v_guardian_email
    ) then
      return query select 'invalid_selection'::text,array[]::uuid[]; return;
    end if;
  end loop;

  -- A preview is capped at 1,000 rows and one confirmation at 500 rows. This
  -- loop is therefore a bounded batch inside one all-or-nothing transaction.
  for item in
    select row_item from jsonb_array_elements(target.preview_rows) row_item
    where (row_item->>'row')::integer=any(sorted_rows)
    order by (row_item->>'row')::integer
  loop
    identity := item->'athlete';
    v_given_name := public.canonical_registration_text(identity->>'givenName');
    v_family_name := public.canonical_registration_text(identity->>'familyName');
    v_birth_date_text := identity->>'birthDate';
    v_guardian_name := case when identity ? 'guardianName' then public.canonical_registration_text(identity->>'guardianName') end;
    v_guardian_email := case when identity ? 'guardianEmail' then lower(public.canonical_registration_text(identity->>'guardianEmail')) end;
    v_guardian_phone := case when identity ? 'guardianPhone' then public.canonical_registration_text(identity->>'guardianPhone') end;
    insert into public.athletes(organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
    values(p_organization_id,v_given_name,v_family_name,lower(v_given_name),lower(v_family_name),v_birth_date_text::date)
    returning id into created_athlete;
    created_ids := array_append(created_ids,created_athlete);
    if v_guardian_email is not null then
      insert into public.guardians(organization_id,name,email,normalized_email,phone)
      values(p_organization_id,v_guardian_name,v_guardian_email,v_guardian_email,v_guardian_phone)
      returning id into created_guardian;
      insert into public.athlete_guardians(organization_id,athlete_id,guardian_id)
      values(p_organization_id,created_athlete,created_guardian);
    end if;
  end loop;

  update public.athlete_import_previews set
    committed_at=clock_timestamp(),selection_digest=requested_digest,result_athlete_ids=created_ids
  where id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
  values(p_organization_id,auth.uid(),'athletes.imported','athlete_import',target.id);
  return query select 'committed'::text,created_ids;
end;
$$;

revoke all on function public.create_athlete_import_preview(uuid,text,jsonb,jsonb),
  public.commit_athlete_import(uuid,uuid,integer[])
from public,anon,authenticated,service_role;
grant execute on function public.create_athlete_import_preview(uuid,text,jsonb,jsonb),
  public.commit_athlete_import(uuid,uuid,integer[])
to authenticated;
