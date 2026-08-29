-- CSV import hardening: a truthful 500-row bound, expiry-aware PII reads,
-- explicit duplicate decisions, NFC identity matching, and tenant/root locks.

alter table public.athlete_import_previews
  drop constraint athlete_import_previews_rows_check,
  add constraint athlete_import_previews_rows_check check(
    jsonb_typeof(preview_rows)='array' and jsonb_array_length(preview_rows) between 1 and 500
  ),
  add column duplicate_decisions jsonb not null default '{}'::jsonb,
  add constraint athlete_import_previews_duplicate_decisions_check check(jsonb_typeof(duplicate_decisions)='object');

drop policy athlete_import_previews_select_administrators on public.athlete_import_previews;
create policy athlete_import_previews_select_administrators
on public.athlete_import_previews for select to authenticated
using(
  expires_at > clock_timestamp()
  and public.is_active_organization_member(organization_id,array['owner','administrator'])
);

create function public.canonical_import_text(value text)
returns text language sql immutable strict set search_path='' as $$
  select normalize(public.canonical_registration_text(value), NFC)
$$;
revoke all on function public.canonical_import_text(text) from public,anon,authenticated;
revoke all on function public.canonical_import_text(text) from service_role;

create index athletes_import_identity_nfc_idx on public.athletes(
  organization_id,
  (normalize(normalized_given_name,NFC)),
  (normalize(normalized_family_name,NFC)),
  birth_date
);

create function public.purge_expired_athlete_import_previews(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if auth.uid() is null or not exists(
    select 1 from public.organization_members membership
    where membership.user_id=auth.uid() and membership.status='active'
      and membership.role in ('owner','administrator')
  ) then
    raise exception 'athlete import purge forbidden' using errcode='42501';
  end if;
  if p_limit not between 1 and 500 then
    raise exception 'invalid purge limit' using errcode='22023';
  end if;
  with expired as (
    select id from public.athlete_import_previews
    where expires_at <= clock_timestamp()
      and public.is_active_organization_member(organization_id,array['owner','administrator'])
    order by expires_at,id limit p_limit for update skip locked
  )
  delete from public.athlete_import_previews target using expired where target.id=expired.id;
  get diagnostics removed=row_count;
  return removed;
end;
$$;

create or replace function public.create_athlete_import_preview(
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
    or jsonb_array_length(p_preview_rows) not between 1 and 500
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
  then raise exception 'invalid athlete import preview' using errcode='22023'; end if;

  with expired as (
    select old_preview.id from public.athlete_import_previews old_preview
    where old_preview.organization_id=p_organization_id
      and old_preview.expires_at <= clock_timestamp()
    order by old_preview.expires_at limit 100
    for update skip locked
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

create function public.resolve_athlete_import_duplicate(
  p_organization_id uuid,
  p_preview_id uuid,
  p_row integer,
  p_decision text
)
returns table(outcome text)
language plpgsql security definer set search_path='' as $$
declare target public.athlete_import_previews%rowtype;
declare item jsonb;
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
  if target.expires_at <= clock_timestamp() then
    return query select 'expired'::text; return;
  end if;
  if target.committed_at is not null then
    return query select 'conflict'::text; return;
  end if;
  select row_item into item from jsonb_array_elements(target.preview_rows) row_item
  where (row_item->>'row')::integer=p_row;
  if item is null or item->>'status' not in ('valid','duplicate_candidate')
    or jsonb_array_length(item->'errors') <> 0 then
    return query select 'invalid_decision'::text; return;
  end if;
  update public.athlete_import_previews set
    duplicate_decisions=jsonb_set(duplicate_decisions,array[p_row::text],to_jsonb(p_decision),true),
    preview_rows=(
      select jsonb_agg(
        case when (row_item->>'row')::integer=p_row
          then jsonb_set(row_item,'{status}','"valid"'::jsonb,false)
          else row_item end
        order by (row_item->>'row')::integer
      ) from jsonb_array_elements(preview_rows) row_item
    )
  where id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
  values(p_organization_id,auth.uid(),'athlete_import_duplicate.kept_separate','athlete_import',target.id);
  return query select 'resolved'::text;
end;
$$;

alter table public.registration_duplicate_candidates
  add column resolution text,
  add column resolved_at timestamptz,
  add column resolved_by_user_id uuid references auth.users(id) on delete set null,
  add constraint registration_duplicate_candidates_resolution_check check(
    (resolution is null and resolved_at is null and resolved_by_user_id is null)
    or (resolution in ('keep_separate','dismiss_candidate') and resolved_at is not null and resolved_by_user_id is not null)
  );

create function public.resolve_registration_duplicate(
  p_organization_id uuid,
  p_candidate_id uuid,
  p_decision text
)
returns table(outcome text)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
    raise exception 'duplicate resolution forbidden' using errcode='42501';
  end if;
  if p_decision not in ('keep_separate','dismiss_candidate') then
    return query select 'invalid_decision'::text; return;
  end if;
  update public.registration_duplicate_candidates set
    resolution=p_decision,resolved_at=clock_timestamp(),resolved_by_user_id=auth.uid()
  where organization_id=p_organization_id and id=p_candidate_id and resolution is null;
  if not found then return query select 'conflict'::text; return; end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
  values(p_organization_id,auth.uid(),'registration_duplicate.resolved.'||p_decision,'registration_duplicate_candidate',p_candidate_id);
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
  sorted_rows integer[];
  requested_digest text;
  item jsonb;
  identity jsonb;
  v_row integer;
  v_given_name text;
  v_family_name text;
  v_birth_date_text text;
  v_guardian_name text;
  v_guardian_email text;
  v_guardian_phone text;
  v_identity_key text;
  v_decision text;
  v_candidate_ids jsonb;
  v_prior_row integer;
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
  then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;
  select array_agg(row_number order by row_number) into sorted_rows from unnest(p_selected_rows) row_number;
  requested_digest := encode(extensions.digest(array_to_string(sorted_rows,','),'sha256'),'hex');

  select * into target from public.athlete_import_previews
  where organization_id=p_organization_id and id=p_preview_id for update;
  if not found then raise exception 'athlete import forbidden' using errcode='42501'; end if;
  if target.actor_user_id <> auth.uid() then raise exception 'athlete import actor mismatch' using errcode='42501'; end if;
  if target.committed_at is not null then
    if target.selection_digest=requested_digest then return query select 'replayed'::text,target.result_athlete_ids;
    else return query select 'conflict'::text,array[]::uuid[]; end if;
    return;
  end if;
  if target.expires_at <= clock_timestamp() then return query select 'expired'::text,array[]::uuid[]; return; end if;
  if (select count(*) from jsonb_array_elements(target.preview_rows) row_item
      where (row_item->>'row')::integer=any(sorted_rows) and row_item->>'status'='valid') <> cardinality(sorted_rows)
  then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;

  -- Lock each canonical tenant/root identity in deterministic order. This is
  -- shared by separate previews, so concurrent commits cannot both pass.
  for v_identity_key in
    select distinct concat_ws('|',p_organization_id::text,
      lower(public.canonical_import_text(row_item->'athlete'->>'givenName')),
      lower(public.canonical_import_text(row_item->'athlete'->>'familyName')),
      row_item->'athlete'->>'birthDate')
    from jsonb_array_elements(target.preview_rows) row_item
    where (row_item->>'row')::integer=any(sorted_rows)
    order by 1
  loop perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_identity_key,0)); end loop;

  for item in select row_item from jsonb_array_elements(target.preview_rows) row_item
    where (row_item->>'row')::integer=any(sorted_rows) order by (row_item->>'row')::integer
  loop
    identity := item->'athlete'; v_row := (item->>'row')::integer;
    v_decision := target.duplicate_decisions->>v_row::text;
    if jsonb_typeof(identity->'givenName') is distinct from 'string'
      or jsonb_typeof(identity->'familyName') is distinct from 'string'
      or jsonb_typeof(identity->'birthDate') is distinct from 'string'
      or (identity ? 'guardianName' and jsonb_typeof(identity->'guardianName') is distinct from 'string')
      or (identity ? 'guardianEmail' and jsonb_typeof(identity->'guardianEmail') is distinct from 'string')
      or (identity ? 'guardianPhone' and jsonb_typeof(identity->'guardianPhone') is distinct from 'string')
      or (identity ? 'guardianName') <> (identity ? 'guardianEmail')
    then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;
    v_given_name := public.canonical_import_text(identity->>'givenName');
    v_family_name := public.canonical_import_text(identity->>'familyName');
    v_birth_date_text := public.canonical_import_text(identity->>'birthDate');
    v_guardian_name := case when identity ? 'guardianName' then public.canonical_import_text(identity->>'guardianName') end;
    v_guardian_email := case when identity ? 'guardianEmail' then lower(public.canonical_import_text(identity->>'guardianEmail')) end;
    v_guardian_phone := case when identity ? 'guardianPhone' then public.canonical_import_text(identity->>'guardianPhone') end;
    if char_length(v_given_name) not between 1 and 120 or char_length(v_family_name) not between 1 and 120
      or not public.is_valid_registration_calendar_date(v_birth_date_text) or v_birth_date_text::date > current_date
      or (v_guardian_name is not null and char_length(v_guardian_name) not between 1 and 160)
      or (v_guardian_email is not null and not public.is_valid_registration_email(v_guardian_email))
      or (v_guardian_phone is not null and not public.is_valid_registration_phone(v_guardian_phone))
      or (v_guardian_phone is not null and v_guardian_email is null)
    then return query select 'invalid_selection'::text,array[]::uuid[]; return; end if;
    select coalesce(jsonb_agg(to_jsonb(athlete.id::text) order by athlete.id),'[]'::jsonb)
      into v_candidate_ids
      from public.athletes athlete where athlete.organization_id=p_organization_id
        and normalize(athlete.normalized_given_name,NFC)=lower(v_given_name)
        and normalize(athlete.normalized_family_name,NFC)=lower(v_family_name)
        and athlete.birth_date=v_birth_date_text::date;
    if jsonb_array_length(v_candidate_ids) > 0 and v_decision is distinct from 'keep_separate' then
      update public.athlete_import_previews set preview_rows=(
        select jsonb_agg(
          case when (row_item->>'row')::integer=v_row then
            jsonb_set(jsonb_set(row_item,'{status}',to_jsonb('duplicate_candidate'::text),false),'{duplicateCandidateIds}',v_candidate_ids,false)
          else row_item end order by (row_item->>'row')::integer
        ) from jsonb_array_elements(preview_rows) row_item
      ) where id=target.id;
      return query select 'invalid_selection'::text,array[]::uuid[]; return;
    end if;
    -- Catch a repeated selected row before inserts. The later row must carry
    -- the explicit keep-separate decision recorded by the review function.
    select min((prior->>'row')::integer) into v_prior_row
      from jsonb_array_elements(target.preview_rows) prior
      where (prior->>'row')::integer=any(sorted_rows) and (prior->>'row')::integer < v_row
        and lower(public.canonical_import_text(prior->'athlete'->>'givenName'))=lower(v_given_name)
        and lower(public.canonical_import_text(prior->'athlete'->>'familyName'))=lower(v_family_name)
        and public.canonical_import_text(prior->'athlete'->>'birthDate')=v_birth_date_text;
    if v_prior_row is not null and v_decision is distinct from 'keep_separate' then
      update public.athlete_import_previews set preview_rows=(
        select jsonb_agg(
          case when (row_item->>'row')::integer=v_row then
            jsonb_set(
              jsonb_set(row_item,'{status}',to_jsonb('duplicate_candidate'::text),false),
              '{duplicateCandidateIds}',to_jsonb(array['preview-row:'||v_prior_row::text]),false
            )
          else row_item end order by (row_item->>'row')::integer
        ) from jsonb_array_elements(preview_rows) row_item
      ) where id=target.id;
      return query select 'invalid_selection'::text,array[]::uuid[]; return;
    end if;
  end loop;

  for item in select row_item from jsonb_array_elements(target.preview_rows) row_item
    where (row_item->>'row')::integer=any(sorted_rows) order by (row_item->>'row')::integer
  loop
    identity := item->'athlete';
    v_given_name := public.canonical_import_text(identity->>'givenName');
    v_family_name := public.canonical_import_text(identity->>'familyName');
    v_birth_date_text := public.canonical_import_text(identity->>'birthDate');
    v_guardian_name := case when identity ? 'guardianName' then public.canonical_import_text(identity->>'guardianName') end;
    v_guardian_email := case when identity ? 'guardianEmail' then lower(public.canonical_import_text(identity->>'guardianEmail')) end;
    v_guardian_phone := case when identity ? 'guardianPhone' then public.canonical_import_text(identity->>'guardianPhone') end;
    insert into public.athletes(organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
    values(p_organization_id,v_given_name,v_family_name,lower(v_given_name),lower(v_family_name),v_birth_date_text::date)
    returning id into created_athlete;
    created_ids := array_append(created_ids,created_athlete);
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

revoke all on function public.purge_expired_athlete_import_previews(integer),
  public.resolve_athlete_import_duplicate(uuid,uuid,integer,text),
  public.resolve_registration_duplicate(uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.purge_expired_athlete_import_previews(integer),
  public.resolve_athlete_import_duplicate(uuid,uuid,integer,text),
  public.resolve_registration_duplicate(uuid,uuid,text)
to authenticated;
