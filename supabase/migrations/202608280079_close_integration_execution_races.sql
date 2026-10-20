-- Close remaining integration execution races, replay, retention, and ACL gaps.

alter table public.integration_export_previews
  add column existing_athlete_ids uuid[] not null default '{}'::uuid[],
  add constraint integration_export_previews_existing_athletes_check
    check(cardinality(existing_athlete_ids) between 0 and 5000);

update public.integration_export_previews preview
set existing_athlete_ids=coalesce((
  select array_agg((athlete->>'registrationId')::uuid order by athlete->>'registrationId')
  from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete
  where exists(
    select 1 from public.external_entity_mappings mapping
    where mapping.organization_id=preview.organization_id
      and mapping.connection_id=preview.connection_id
      and mapping.entity_type='athlete'
      and mapping.internal_entity_id=(athlete->>'registrationId')::uuid
  )
),'{}'::uuid[])
where preview.stage<>'redacted';

alter table public.integration_outbox_jobs
  add column completion_result_digest text,
  add constraint integration_outbox_jobs_completion_digest_check
    check(completion_result_digest is null or completion_result_digest ~ '^[0-9a-f]{64}$');

create function private.bind_integration_preview_mapping_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select coalesce(array_agg((athlete->>'registrationId')::uuid order by athlete->>'registrationId'),'{}'::uuid[])
  into new.existing_athlete_ids
  from jsonb_array_elements(new.roster_snapshot->'athletes') athlete
  where exists(
    select 1 from public.external_entity_mappings mapping
    where mapping.organization_id=new.organization_id
      and mapping.connection_id=new.connection_id
      and mapping.entity_type='athlete'
      and mapping.internal_entity_id=(athlete->>'registrationId')::uuid
  );
  return new;
end $$;

create trigger bind_integration_preview_mapping_snapshot
before insert on public.integration_export_previews for each row
execute function private.bind_integration_preview_mapping_snapshot();

create function private.cap_integration_preview_expiry() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.expires_at:=least(new.expires_at,new.created_at+interval '7 days');
  return new;
end $$;

create trigger cap_integration_preview_expiry
before insert or update of expires_at on public.integration_export_previews for each row
execute function private.cap_integration_preview_expiry();

create or replace function public.save_roster_export_preview_v2(
  p_organization_id uuid,p_source_id uuid,p_source_digest text,p_provider_preview_id text,p_confirmation_token text,p_preview jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare source public.integration_export_previews%rowtype; item jsonb; athlete jsonb; expected_fields jsonb;
  team_name text; expected_label text; expected_operation text;
begin
  if not private.can_manage_integrations(p_organization_id) then return 'forbidden'; end if;
  select * into source from public.integration_export_previews where organization_id=p_organization_id and id=p_source_id for update;
  if not found or source.created_by_user_id<>auth.uid() then return 'not_found'; end if;
  if source.stage='ready' then
    return case when source.source_digest=p_source_digest
      and source.provider_preview_id=p_provider_preview_id
      and source.provider_confirmation_token=p_confirmation_token
      and source.preview_snapshot=p_preview
      then 'replayed' else 'conflict' end;
  end if;
  if source.stage<>'source' or source.expires_at<=clock_timestamp() then return 'stale'; end if;
  if source.source_digest<>p_source_digest or p_provider_preview_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_confirmation_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$' or jsonb_typeof(p_preview)<>'object'
    or p_preview->>'previewId' is distinct from p_provider_preview_id or p_preview->>'confirmationToken' is distinct from p_confirmation_token
    or (p_preview->>'snapshotDigest') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_preview->'items')<>'array'
    or coalesce(p_preview->>'totalItems','') !~ '^[0-9]{1,4}$'
    or (p_preview->>'totalItems')::integer is distinct from jsonb_array_length(source.roster_snapshot->'athletes')
    or jsonb_array_length(p_preview->'items')<>jsonb_array_length(source.roster_snapshot->'athletes')
    or coalesce(p_preview->>'mockData','') not in ('true','false')
    or (p_preview->>'mockData')::boolean is distinct from (source.destination_snapshot->>'mockData')::boolean
    or (select count(distinct value->>'itemKey') from jsonb_array_elements(p_preview->'items'))<>jsonb_array_length(p_preview->'items')
    or (select count(distinct value->>'registrationId') from jsonb_array_elements(p_preview->'items'))<>jsonb_array_length(p_preview->'items')
    or exists(
      select 1 from jsonb_array_elements(source.roster_snapshot->'athletes') source_athlete
      where (select count(*) from jsonb_array_elements(p_preview->'items') candidate
        where candidate->>'registrationId'=source_athlete->>'registrationId'
          and candidate->>'itemKey'='athlete:'||(source_athlete->>'registrationId'))<>1
    )
    or exists(
      select 1 from jsonb_array_elements(p_preview->'items') candidate
      where not exists(select 1 from jsonb_array_elements(source.roster_snapshot->'athletes') source_athlete
        where source_athlete->>'registrationId'=candidate->>'registrationId')
    )
  then return 'conflict'; end if;
  for item in select value from jsonb_array_elements(p_preview->'items') loop
    select value into athlete from jsonb_array_elements(source.roster_snapshot->'athletes') where value->>'registrationId'=item->>'registrationId';
    select team->>'name' into team_name from jsonb_array_elements(source.roster_snapshot->'teams') team where team->>'id'=athlete->>'teamId';
    expected_operation:=case when (athlete->>'registrationId')::uuid=any(source.existing_athlete_ids) then 'update' else 'create' end;
    if item->>'operation' is distinct from expected_operation
      and not coalesce(expected_operation='create' and item->>'operation'='requires_review',false)
    then return 'conflict'; end if;
    expected_label:=case
      when 'first_name'=any(source.approved_fields) and 'last_name'=any(source.approved_fields) then (athlete->>'firstName')||' '||(athlete->>'lastName')
      when 'tryout_number'=any(source.approved_fields) and athlete ? 'tryoutNumber' then 'Tryout #'||(athlete->>'tryoutNumber')
      else 'Registration '||(athlete->>'registrationId') end;
    if item->>'displayLabel' is distinct from expected_label then return 'conflict'; end if;
    expected_fields:=jsonb_strip_nulls('{}'::jsonb
      ||case when 'first_name'=any(source.approved_fields) then jsonb_build_object('firstName',athlete->>'firstName') else '{}'::jsonb end
      ||case when 'last_name'=any(source.approved_fields) then jsonb_build_object('lastName',athlete->>'lastName') else '{}'::jsonb end
      ||case when 'email'=any(source.approved_fields) and athlete ? 'email' then jsonb_build_object('email',athlete->>'email') else '{}'::jsonb end
      ||case when 'phone'=any(source.approved_fields) and athlete ? 'phone' then jsonb_build_object('phone',athlete->>'phone') else '{}'::jsonb end
      ||case when 'position'=any(source.approved_fields) and athlete ? 'position' then jsonb_build_object('position',athlete->>'position') else '{}'::jsonb end
      ||case when 'team_name'=any(source.approved_fields) then jsonb_build_object('teamName',team_name) else '{}'::jsonb end
      ||case when 'tryout_number'=any(source.approved_fields) and athlete ? 'tryoutNumber' then jsonb_build_object('tryoutNumber',(athlete->>'tryoutNumber')::integer) else '{}'::jsonb end);
    if item->'fields' is distinct from expected_fields then return 'conflict'; end if;
  end loop;
  update public.integration_export_previews set provider_preview_id=p_provider_preview_id,provider_confirmation_token=p_confirmation_token,
    provider_snapshot_digest=p_preview->>'snapshotDigest',preview_snapshot=p_preview,stage='ready',expires_at=created_at+interval '7 days'
    where id=source.id;
  return 'created';
end $$;

create or replace function private.check_integration_outbox_execution(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_mark_submission boolean
) returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype; sync public.integration_sync_jobs%rowtype;
  member public.organization_members%rowtype; connection public.integration_connections%rowtype;
  roster public.roster_versions%rowtype; preview public.integration_export_previews%rowtype;
begin
  select * into target from public.integration_outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation then return 'lease_conflict'; end if;
  select * into sync from public.integration_sync_jobs where organization_id=target.organization_id and id=target.sync_job_id for update;
  if sync.id is null then return 'lease_conflict'; end if;
  if target.lease_expires_at<=clock_timestamp() then
    if target.provider_submission_started_at is null then return 'lease_conflict'; end if;
    update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
    update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
    update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false where organization_id=sync.organization_id and sync_job_id=sync.id and state not in ('completed','skipped');
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=sync.source_preview_id and stage<>'redacted';
    return 'delivery_uncertain';
  end if;
  -- Canonical lock order after the outbox and sync rows: membership, connection, roster, source.
  select * into member from public.organization_members candidate where candidate.organization_id=sync.organization_id and candidate.user_id=sync.created_by_user_id for share;
  select * into connection from public.integration_connections candidate where candidate.organization_id=sync.organization_id and candidate.id=sync.connection_id for share;
  select * into roster from public.roster_versions candidate where candidate.organization_id=sync.organization_id and candidate.id=sync.roster_version_id for share;
  select * into preview from public.integration_export_previews candidate where candidate.organization_id=sync.organization_id and candidate.id=sync.source_preview_id for share;
  if member.user_id is null or member.status<>'active' or member.role not in ('owner','administrator')
    or connection.id is null or connection.created_by_user_id<>sync.created_by_user_id or connection.state<>'connected'
    or roster.id is null or roster.state<>'finalized' or roster.version<>sync.roster_version
    or preview.id is null or preview.stage<>'ready' or preview.source_digest<>sync.request_digest or preview.expires_at<=clock_timestamp()
  then
    if target.provider_submission_started_at is not null then
      update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
      update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false where organization_id=sync.organization_id and sync_job_id=sync.id and state not in ('completed','skipped');
      update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=sync.source_preview_id and stage<>'redacted';
      return 'delivery_uncertain';
    end if;
    update public.integration_outbox_jobs set status='cancelled',last_error_code='authorization_revoked',cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
    update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp(),last_error='{"code":"authorization_revoked","retryable":false}' where id=sync.id;
    update public.integration_sync_items set state='cancelled',normalized_error='{"code":"authorization_revoked","retryable":false}',retry_eligible=false where organization_id=sync.organization_id and sync_job_id=sync.id and state not in ('completed','skipped');
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=sync.source_preview_id and stage<>'redacted';
    return 'authorization_revoked';
  end if;
  if p_mark_submission then
    -- The marker and every authorization predicate are protected by the locks above.
    update public.integration_outbox_jobs set provider_submission_started_at=coalesce(provider_submission_started_at,clock_timestamp()) where id=p_job_id;
  end if;
  return 'authorized';
end $$;

create or replace function public.claim_integration_outbox_jobs(p_lease_owner text,p_batch_size integer,p_lease_seconds integer)
returns setof public.claimed_integration_outbox_job language plpgsql security definer set search_path='' as $$
declare candidate public.integration_outbox_jobs%rowtype; target public.integration_outbox_jobs%rowtype;
  sync public.integration_sync_jobs%rowtype; preview public.integration_export_previews%rowtype;
  result public.claimed_integration_outbox_job; returned integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$' or p_batch_size not between 1 and 50 or p_lease_seconds not between 30 and 300 then raise exception 'invalid job claim' using errcode='22023'; end if;
  -- Terminalize a bounded exhausted/uncertain set separately so it cannot hide healthy work.
  for candidate in select * from public.integration_outbox_jobs job
    where job.status='leased' and job.lease_expires_at<=clock_timestamp()
      and (job.provider_submission_started_at is not null or job.attempt_count>=job.max_attempts)
    order by job.available_at,job.created_at,job.id limit p_batch_size
  loop
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.status<>'leased' or target.lease_expires_at>clock_timestamp() then continue; end if;
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
    if target.provider_submission_started_at is not null then
      update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
      update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys) and state not in ('completed','skipped');
    else
      update public.integration_outbox_jobs set status='dead_letter',last_error_code='attempts_exhausted',dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs set state='failed',last_error='{"code":"attempts_exhausted","retryable":false}' where id=sync.id;
      update public.integration_sync_items set state='failed',normalized_error='{"code":"attempts_exhausted","retryable":false}',retry_eligible=false where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys) and state not in ('completed','skipped');
    end if;
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=sync.source_preview_id and stage<>'redacted';
  end loop;
  for candidate in select * from public.integration_outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp()) and job.attempt_count<job.max_attempts
    order by job.available_at,job.created_at,job.id limit p_batch_size*2
  loop
    exit when returned>=p_batch_size;
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.status not in ('pending','leased') or target.available_at>clock_timestamp()
      or target.attempt_count>=target.max_attempts or (target.status='leased' and target.lease_expires_at>clock_timestamp()) then continue; end if;
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
    select * into preview from public.integration_export_previews where id=sync.source_preview_id for share;
    if preview.id is null or preview.stage<>'ready' or preview.expires_at<=clock_timestamp() then
      update public.integration_outbox_jobs set status='cancelled',last_error_code='source_expired',cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp(),last_error='{"code":"source_expired","retryable":false}' where id=target.sync_job_id;
      update public.integration_sync_items set state='cancelled',normalized_error='{"code":"source_expired","retryable":false}',retry_eligible=false where sync_job_id=target.sync_job_id and state not in ('completed','skipped');
      update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=sync.source_preview_id and stage<>'redacted';
      continue;
    end if;
    update public.integration_outbox_jobs set status='leased',attempt_count=attempt_count+1,lease_owner=p_lease_owner,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null where id=target.id returning * into target;
    update public.integration_sync_items set state='processing',attempts=attempts+1 where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys) and state='pending';
    update public.integration_sync_jobs set state='processing' where id=sync.id;
    result:=(target.id,target.sync_job_id,target.organization_id,sync.connection_id,sync.provider_key,sync.created_by_user_id,target.lease_token,target.lease_generation,target.lease_expires_at,target.provider_idempotency_key,target.attempt_number,target.item_keys,
      jsonb_build_object('destination',sync.destination_snapshot,'approvedFields',sync.approved_fields,
        'roster',jsonb_set(preview.roster_snapshot,'{athletes}',coalesce((select jsonb_agg(athlete order by athlete->>'registrationId') from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete where 'athlete:'||(athlete->>'registrationId')=any(target.item_keys)),'[]'::jsonb)),
        'previewId',sync.provider_preview_id,'confirmationToken',preview.provider_confirmation_token));
    returned:=returned+1;
    return next result;
  end loop;
end $$;

create function private.integration_item_retry_is_safe(p_state text,p_error jsonb) returns boolean
language sql immutable set search_path='' as $$
  select p_state='failed'
    and coalesce((p_error->>'retryable')::boolean,false)
    and p_error->>'code' in ('rate_limited','provider_temporary','timeout')
$$;

alter function public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb) rename to complete_integration_outbox_job_legacy_078;
create function public.complete_integration_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_external_job_id text,p_result jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype; sync public.integration_sync_jobs%rowtype; preview public.integration_export_previews%rowtype;
  lock_key text; result_digest text; outcome text; expected integer;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_external_job_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' or jsonb_typeof(p_result)<>'object' then return 'invalid_input'; end if;
  result_digest:=encode(extensions.digest(p_result::text,'sha256'),'hex');
  select * into target from public.integration_outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status='completed' then
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id;
    return case when sync.external_job_id=p_external_job_id and target.completion_result_digest=result_digest then 'replayed' else 'terminal_conflict' end;
  end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation
    or target.lease_expires_at<=clock_timestamp() or target.provider_submission_started_at is null then return 'lease_conflict'; end if;
  select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
  select * into preview from public.integration_export_previews where id=sync.source_preview_id for share;
  if preview.id is null or preview.stage<>'ready' or jsonb_typeof(p_result->'entityMappings')<>'array' then return 'invalid_input'; end if;
  expected:=jsonb_array_length(preview.roster_snapshot->'teams')+1;
  if jsonb_array_length(p_result->'entityMappings')<>expected then return 'invalid_input'; end if;
  -- Lock every athlete/team/roster mapping key in one canonical order before any mapping write.
  for lock_key in
    select key from (
      select item.entity_type||':'||item.internal_entity_id::text key
      from jsonb_array_elements(p_result->'items') result_item
      join public.integration_sync_items item on item.organization_id=sync.organization_id and item.sync_job_id=sync.id and item.item_key=result_item->>'itemKey'
      where result_item->>'state'='completed'
      union
      select (proof->>'entityType')||':'||(proof->>'internalEntityId') from jsonb_array_elements(p_result->'entityMappings') proof
    ) keys order by key
  loop
    perform pg_advisory_xact_lock(hashtextextended('integration-map:'||sync.organization_id||':'||sync.connection_id||':'||lock_key,0));
  end loop;
  outcome:=public.complete_integration_outbox_job_legacy_078(p_job_id,p_lease_token,p_lease_generation,p_external_job_id,p_result);
  if outcome='completed' then
    update public.integration_outbox_jobs set completion_result_digest=result_digest where id=p_job_id;
    update public.integration_sync_items set retry_eligible=private.integration_item_retry_is_safe(state,normalized_error)
      where organization_id=sync.organization_id and sync_job_id=sync.id;
  end if;
  return outcome;
end $$;

alter function public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean) rename to fail_integration_outbox_job_legacy_078;
create function public.fail_integration_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_error_code text,p_retryable boolean)
returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype; sync public.integration_sync_jobs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_error_code !~ '^[a-z][a-z0-9_]{2,63}$' then return 'invalid_input'; end if;
  select * into target from public.integration_outbox_jobs where id=p_job_id for update;
  if target.id is not null and target.status='leased' and target.lease_token is not distinct from p_lease_token
    and target.lease_generation=p_lease_generation and target.provider_submission_started_at is not null then
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
    update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',
      dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
    update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),
      last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
    update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}',
      retry_eligible=false where organization_id=target.organization_id and sync_job_id=target.sync_job_id
        and item_key=any(target.item_keys) and state not in ('completed','skipped');
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,
      redacted_at=clock_timestamp() where id=sync.source_preview_id and stage<>'redacted';
    return 'needs_attention';
  end if;
  return public.fail_integration_outbox_job_legacy_078(p_job_id,p_lease_token,p_lease_generation,p_error_code,p_retryable);
end $$;

create or replace function public.purge_expired_integration_previews(p_limit integer) returns integer
language plpgsql security definer set search_path='' as $$
declare candidate record; preview public.integration_export_previews%rowtype; sync public.integration_sync_jobs%rowtype;
  outbox public.integration_outbox_jobs%rowtype; affected integer:=0; active_lease boolean; handed_off boolean;
begin
  if auth.role()<>'service_role' or p_limit not between 1 and 500 then raise exception 'forbidden' using errcode='42501'; end if;
  for candidate in select id,sync_job_id from public.integration_export_previews where expires_at<=clock_timestamp() and stage<>'redacted' order by expires_at,id limit p_limit loop
    active_lease:=false; handed_off:=false;
    if candidate.sync_job_id is not null then
      select * into sync from public.integration_sync_jobs where id=candidate.sync_job_id for update;
      for outbox in select * from public.integration_outbox_jobs where sync_job_id=candidate.sync_job_id order by id for update loop
        active_lease:=active_lease or (outbox.status='leased' and outbox.lease_expires_at>clock_timestamp());
        handed_off:=handed_off or (outbox.provider_submission_started_at is not null and outbox.status in ('pending','leased'));
      end loop;
      if active_lease then continue; end if;
    end if;
    select * into preview from public.integration_export_previews where id=candidate.id for update;
    if not found or preview.stage='redacted' or preview.expires_at>clock_timestamp() then continue; end if;
    if preview.sync_job_id is null then
      delete from public.integration_export_previews where id=preview.id;
      affected:=affected+1;
      continue;
    end if;
    if sync.state not in ('completed','cancelled','needs_attention') then
      if handed_off then
        update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where sync_job_id=sync.id and status in ('pending','leased');
        update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
        update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false where sync_job_id=sync.id and state not in ('completed','skipped');
      else
        update public.integration_outbox_jobs set status='cancelled',last_error_code='source_expired',cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where sync_job_id=sync.id and status in ('pending','leased');
        update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp(),last_error='{"code":"source_expired","retryable":false}' where id=sync.id;
        update public.integration_sync_items set state='cancelled',normalized_error='{"code":"source_expired","retryable":false}',retry_eligible=false where sync_job_id=sync.id and state not in ('completed','skipped');
      end if;
    end if;
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=preview.id;
    affected:=affected+1;
  end loop;
  return affected;
end $$;

create type public.integration_export_confirmation_v3_result as (
  outcome text,job_id uuid,state text,item_count integer,completed_count integer,skipped_count integer,
  failed_count integer,retry_eligible_count integer
);

create function public.confirm_roster_export_preview_v3(
  p_organization_id uuid,p_provider_preview_id text,p_confirmation_token text,p_idempotency_key text
) returns public.integration_export_confirmation_v3_result language plpgsql security definer set search_path='' as $$
declare prior public.integration_export_confirmation_v2_result; retry_count integer:=0;
begin
  prior:=public.confirm_roster_export_preview_v2(p_organization_id,p_provider_preview_id,p_confirmation_token,p_idempotency_key);
  if prior.outcome in ('queued','replayed','completed') then
    select count(*)::integer into retry_count from public.integration_sync_items item
      where item.organization_id=p_organization_id and item.sync_job_id=prior.job_id
        and item.state in ('failed','requires_review') and item.retry_eligible;
  end if;
  return (prior.outcome,prior.job_id,prior.state,prior.item_count,prior.completed_count,prior.skipped_count,
    prior.failed_count,retry_count)::public.integration_export_confirmation_v3_result;
end $$;

revoke all on function public.load_roster_export_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.confirm_roster_export_preview_v3(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.confirm_roster_export_preview_v3(uuid,text,text,text) to authenticated;
revoke all on function public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb),public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean),
  public.complete_integration_outbox_job_legacy_078(uuid,uuid,bigint,text,jsonb),public.fail_integration_outbox_job_legacy_078(uuid,uuid,bigint,text,boolean)
from public,anon,authenticated,service_role;
grant execute on function public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb),public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean) to service_role;
revoke all on function private.bind_integration_preview_mapping_snapshot(),private.cap_integration_preview_expiry() from public,anon,authenticated,service_role;
revoke all on function private.integration_item_retry_is_safe(text,jsonb) from public,anon,authenticated,service_role;
