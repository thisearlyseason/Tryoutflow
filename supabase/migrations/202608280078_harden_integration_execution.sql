-- Close execution-time authorization, immutable-preview, privacy, retry, and
-- terminal-mapping gaps without rewriting the historical integration migration.

alter table public.integration_export_previews
  alter column provider_preview_id drop not null,
  alter column provider_confirmation_token drop not null,
  alter column provider_snapshot_digest drop not null,
  alter column preview_snapshot drop not null,
  add column source_digest text,
  add column stage text not null default 'ready',
  add column redacted_at timestamptz;
update public.integration_export_previews set source_digest=payload_digest where source_digest is null;
alter table public.integration_export_previews
  alter column source_digest set not null,
  add constraint integration_export_previews_source_digest_check check(source_digest ~ '^[0-9a-f]{64}$'),
  add constraint integration_export_previews_stage_check check(stage in ('source','ready','redacted')),
  add constraint integration_export_previews_stage_shape_check check(
    (stage='source' and provider_preview_id is null and provider_confirmation_token is null and preview_snapshot is null and redacted_at is null)
    or (stage='ready' and provider_preview_id is not null and provider_confirmation_token is not null and preview_snapshot is not null and redacted_at is null)
    or (stage='redacted' and provider_confirmation_token is null and roster_snapshot='{}'::jsonb and redacted_at is not null)
  );

create function private.bind_integration_preview_source_digest() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.source_digest:=coalesce(new.source_digest,new.payload_digest);
  return new;
end $$;
create trigger bind_integration_preview_source_digest
before insert on public.integration_export_previews for each row
execute function private.bind_integration_preview_source_digest();

alter table public.integration_sync_jobs
  alter column roster_snapshot drop not null,
  alter column provider_confirmation_token drop not null,
  add column source_preview_id uuid,
  add column approved_projection jsonb not null default '[]'::jsonb,
  add column confirmation_token_digest text,
  add column cancelled_at timestamptz,
  add constraint integration_sync_jobs_source_preview_fkey foreign key(organization_id,source_preview_id)
    references public.integration_export_previews(organization_id,id) on delete restrict,
  add constraint integration_sync_jobs_projection_check check(jsonb_typeof(approved_projection)='array'),
  add constraint integration_sync_jobs_token_digest_check check(confirmation_token_digest is null or confirmation_token_digest ~ '^[0-9a-f]{64}$');
alter table public.integration_sync_jobs drop constraint integration_sync_jobs_state_check;
alter table public.integration_sync_jobs add constraint integration_sync_jobs_state_check
  check(state in ('pending','processing','completed','partially_completed','failed','needs_attention','cancelled'));
alter table public.integration_sync_jobs drop constraint integration_sync_jobs_terminal_check;
alter table public.integration_sync_jobs add constraint integration_sync_jobs_terminal_check check(
  (state='completed' and completed_at is not null and attention_required_at is null and cancelled_at is null)
  or (state='needs_attention' and completed_at is null and attention_required_at is not null and cancelled_at is null)
  or (state='cancelled' and completed_at is null and attention_required_at is null and cancelled_at is not null)
  or (state not in ('completed','needs_attention','cancelled') and completed_at is null and attention_required_at is null and cancelled_at is null)
);

alter table public.integration_sync_items add column retry_eligible boolean not null default false;
alter table public.integration_sync_items drop constraint integration_sync_items_state_check;
alter table public.integration_sync_items add constraint integration_sync_items_state_check
  check(state in ('pending','processing','completed','failed','skipped','requires_review','cancelled'));
alter table public.integration_sync_items drop constraint integration_sync_items_shape_check;
alter table public.integration_sync_items add constraint integration_sync_items_shape_check check(
  (state='pending' and normalized_error is null and completed_at is null and not retry_eligible)
  or (state='processing' and attempts>0 and normalized_error is null and completed_at is null and not retry_eligible)
  or (state in ('completed','skipped') and normalized_error is null and completed_at is not null and not retry_eligible)
  or (state in ('failed','requires_review') and normalized_error is not null and completed_at is null)
  or (state='cancelled' and normalized_error is not null and completed_at is null and not retry_eligible)
);

alter table public.integration_outbox_jobs
  add column job_type text not null default 'integration.roster_export',
  add column payload_version integer not null default 1,
  add column request_digest text,
  add column cancelled_at timestamptz,
  add constraint integration_outbox_jobs_type_check check(job_type='integration.roster_export'),
  add constraint integration_outbox_jobs_payload_version_check check(payload_version=1);
update public.integration_outbox_jobs outbox set request_digest=sync.request_digest
from public.integration_sync_jobs sync where sync.id=outbox.sync_job_id and outbox.request_digest is null;
alter table public.integration_outbox_jobs alter column request_digest set not null;
alter table public.integration_outbox_jobs add constraint integration_outbox_jobs_request_digest_check check(request_digest ~ '^[0-9a-f]{64}$');

create function private.bind_integration_outbox_request_digest() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.request_digest is null then
    select sync.request_digest into new.request_digest
    from public.integration_sync_jobs sync
    where sync.organization_id=new.organization_id and sync.id=new.sync_job_id;
  end if;
  return new;
end $$;
create trigger bind_integration_outbox_request_digest
before insert on public.integration_outbox_jobs for each row
execute function private.bind_integration_outbox_request_digest();

alter table public.integration_outbox_jobs drop constraint integration_outbox_jobs_status_check;
alter table public.integration_outbox_jobs add constraint integration_outbox_jobs_status_check
  check(status in ('pending','leased','completed','dead_letter','needs_attention','cancelled'));
alter table public.integration_outbox_jobs drop constraint integration_outbox_jobs_terminal_check;
alter table public.integration_outbox_jobs add constraint integration_outbox_jobs_terminal_check check(
  (status='completed' and completed_at is not null and dead_lettered_at is null and cancelled_at is null)
  or (status in ('dead_letter','needs_attention') and completed_at is null and dead_lettered_at is not null and cancelled_at is null)
  or (status='cancelled' and completed_at is null and dead_lettered_at is null and cancelled_at is not null)
  or (status in ('pending','leased') and completed_at is null and dead_lettered_at is null and cancelled_at is null)
);
alter table public.integration_outbox_jobs drop constraint integration_outbox_jobs_retry_key;
alter table public.integration_outbox_jobs add constraint integration_outbox_jobs_retry_key
  unique(organization_id,sync_job_id,retry_idempotency_key);

create type public.integration_export_source_result as (
  outcome text,source_id uuid,provider_key text,mock_data boolean,roster jsonb,source_digest text,existing_athlete_ids uuid[]
);

create function public.issue_roster_export_source(
  p_organization_id uuid,p_connection_id uuid,p_roster_version_id uuid,p_destination jsonb,p_approved_fields text[]
) returns public.integration_export_source_result language plpgsql security definer set search_path='' as $$
declare stored public.integration_export_previews%rowtype; existing_ids uuid[];
begin
  if not private.can_manage_integrations(p_organization_id) then return ('forbidden',null,null,null,null,null,null)::public.integration_export_source_result; end if;
  if p_destination is null or jsonb_typeof(p_destination)<>'object'
    or p_destination->>'mockData' not in ('true','false')
    or p_destination->'organization'->>'providerKey' is null
    or cardinality(p_approved_fields) not between 1 and 7
    or p_approved_fields <@ array['first_name','last_name','email','phone','position','team_name','tryout_number']::text[] is not true
    or (select count(*) from unnest(p_approved_fields) f)<>(select count(distinct f) from unnest(p_approved_fields) f)
  then return ('invalid_input',null,null,null,null,null,null)::public.integration_export_source_result; end if;
  with source as (
    select connection.provider_key,connection.mock_data,version.id roster_id,version.version roster_version,
      jsonb_build_object('organizationId',version.organization_id,'tryoutId',version.tryout_id,'divisionId',version.division_id,
        'rosterVersionId',version.id,'version',version.version,'state','finalized','finalizedAt',version.finalized_at,
        'teams',coalesce((select jsonb_agg(jsonb_build_object('id',team.id,'name',team.name) order by team.sort_order,team.id)
          from public.tryout_teams team where team.organization_id=version.organization_id and team.tryout_id=version.tryout_id and team.division_id=version.division_id),'[]'::jsonb),
        'athletes',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'registrationId',assignment.registration_id,'firstName',athlete.given_name,'lastName',athlete.family_name,
          'email',guardian.email::text,'phone',guardian.phone,'position',position.name,'tryoutNumber',number_assignment.number,'teamId',assignment.team_id)) order by assignment.registration_id)
          from public.roster_assignments assignment join public.tryout_registrations registration on registration.organization_id=assignment.organization_id and registration.id=assignment.registration_id
          join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
          left join public.tryout_positions position on position.organization_id=registration.organization_id and position.tryout_id=registration.tryout_id and position.id=registration.position_id
          left join lateral(select guardian.email,guardian.phone from public.athlete_guardians link join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id where link.organization_id=registration.organization_id and link.athlete_id=registration.athlete_id order by link.is_primary_contact desc,guardian.id limit 1) guardian on true
          left join lateral(select candidate.number from public.tryout_numbers candidate where candidate.organization_id=registration.organization_id and candidate.tryout_id=registration.tryout_id and candidate.registration_id=registration.id and candidate.released_at is null order by candidate.assigned_at desc,candidate.id limit 1) number_assignment on true
          where assignment.organization_id=version.organization_id and assignment.roster_version_id=version.id),'[]'::jsonb)) roster
    from public.integration_connections connection join public.roster_versions version on version.organization_id=connection.organization_id
    where connection.organization_id=p_organization_id and connection.id=p_connection_id and connection.created_by_user_id=auth.uid()
      and connection.state='connected' and connection.mock_data=(p_destination->>'mockData')::boolean
      and connection.provider_key=p_destination->'organization'->>'providerKey' and version.id=p_roster_version_id and version.state='finalized'
  ), bound as (
    select source.*,encode(extensions.digest(jsonb_build_object('organizationId',p_organization_id,'actorId',auth.uid(),
      'connectionId',p_connection_id,'destination',p_destination,'approvedFields',p_approved_fields,'roster',source.roster)::text,'sha256'),'hex') digest
    from source
  )
  insert into public.integration_export_previews(organization_id,connection_id,roster_version_id,roster_version,created_by_user_id,
    provider_preview_id,provider_confirmation_token,provider_snapshot_digest,payload_digest,destination_snapshot,approved_fields,
    roster_snapshot,preview_snapshot,source_digest,stage)
  select p_organization_id,p_connection_id,bound.roster_id,bound.roster_version,auth.uid(),null,null,null,bound.digest,
    p_destination,p_approved_fields,bound.roster,null,bound.digest,'source' from bound returning * into stored;
  if not found then return ('not_found',null,null,null,null,null,null)::public.integration_export_source_result; end if;
  select coalesce(array_agg((athlete->>'registrationId')::uuid order by athlete->>'registrationId'),'{}'::uuid[]) into existing_ids
    from jsonb_array_elements(stored.roster_snapshot->'athletes') athlete
    where exists(select 1 from public.external_entity_mappings mapping where mapping.organization_id=p_organization_id
      and mapping.connection_id=p_connection_id and mapping.entity_type='athlete' and mapping.internal_entity_id=(athlete->>'registrationId')::uuid);
  return ('ok',stored.id,(select provider_key from public.integration_connections where id=p_connection_id),
    (select mock_data from public.integration_connections where id=p_connection_id),stored.roster_snapshot,stored.source_digest,existing_ids)::public.integration_export_source_result;
end $$;

create type public.integration_export_confirmation_v2_result as (
  outcome text,job_id uuid,state text,item_count integer,completed_count integer,skipped_count integer,failed_count integer
);

create function public.confirm_roster_export_preview_v2(
  p_organization_id uuid,p_provider_preview_id text,p_confirmation_token text,p_idempotency_key text
) returns public.integration_export_confirmation_v2_result language plpgsql security definer set search_path='' as $$
declare preview public.integration_export_previews%rowtype; existing public.integration_sync_jobs%rowtype;
  connection public.integration_connections%rowtype; version public.roster_versions%rowtype; created_job uuid:=gen_random_uuid(); keys text[];
begin
  if not private.can_manage_integrations(p_organization_id) then return ('forbidden',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  if p_provider_preview_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$' or p_confirmation_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$' then return ('invalid_input',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  select * into preview from public.integration_export_previews where organization_id=p_organization_id and provider_preview_id=p_provider_preview_id;
  if not found or preview.created_by_user_id<>auth.uid() then return ('not_found',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  perform pg_advisory_xact_lock(hashtextextended('integration-confirm:'||p_organization_id::text||':'||preview.connection_id::text||':'||p_idempotency_key,0));
  select * into preview from public.integration_export_previews where id=preview.id for update;
  select * into existing from public.integration_sync_jobs where organization_id=p_organization_id and connection_id=preview.connection_id and business_idempotency_key=p_idempotency_key;
  if found then
    if existing.request_digest=preview.source_digest then
      return ('replayed',existing.id,existing.state,
        (select count(*)::integer from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=existing.id),
        (select count(*)::integer from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=existing.id and state='completed'),
        (select count(*)::integer from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=existing.id and state='skipped'),
        (select count(*)::integer from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=existing.id and state in ('failed','requires_review')))::public.integration_export_confirmation_v2_result;
    end if;
    return ('conflict',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result;
  end if;
  if preview.stage<>'ready' or preview.consumed_at is not null then return ('already_consumed',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  if preview.expires_at<=clock_timestamp() then return ('stale',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  if preview.provider_confirmation_token<>p_confirmation_token then return ('conflict',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  select candidate.* into connection from public.integration_connections candidate where candidate.organization_id=p_organization_id and candidate.id=preview.connection_id
    and candidate.created_by_user_id=auth.uid() and candidate.state='connected' for share;
  if not found then return ('stale',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  select candidate.* into version from public.roster_versions candidate where candidate.organization_id=p_organization_id and candidate.id=preview.roster_version_id
    and candidate.state='finalized' and candidate.version=preview.roster_version for share;
  if not found then return ('stale',null,null,0,0,0,0)::public.integration_export_confirmation_v2_result; end if;
  select coalesce(array_agg('athlete:'||(athlete->>'registrationId') order by athlete->>'registrationId'),'{}'::text[]) into keys
    from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete;
  insert into public.integration_sync_jobs(id,organization_id,connection_id,provider_key,business_idempotency_key,request_digest,
    roster_version_id,roster_version,destination_snapshot,approved_fields,roster_snapshot,provider_preview_id,
    provider_confirmation_token,state,mock_data,created_by_user_id,completed_at,source_preview_id,approved_projection,confirmation_token_digest)
  values(created_job,p_organization_id,preview.connection_id,connection.provider_key,p_idempotency_key,preview.source_digest,
    preview.roster_version_id,preview.roster_version,preview.destination_snapshot,preview.approved_fields,null,preview.provider_preview_id,
    null,case when cardinality(keys)=0 then 'completed' else 'pending' end,connection.mock_data,auth.uid(),
    case when cardinality(keys)=0 then clock_timestamp() else null end,preview.id,coalesce(preview.preview_snapshot->'items','[]'::jsonb),
    encode(extensions.digest(p_confirmation_token,'sha256'),'hex'));
  insert into public.integration_sync_items(organization_id,sync_job_id,item_key,entity_type,internal_entity_id,operation)
  select p_organization_id,created_job,'athlete:'||(athlete->>'registrationId'),'athlete',(athlete->>'registrationId')::uuid,
    coalesce((select item->>'operation' from jsonb_array_elements(preview.preview_snapshot->'items') item where item->>'itemKey'='athlete:'||(athlete->>'registrationId')),'requires_review')
  from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete;
  if cardinality(keys)>0 then
    insert into public.integration_outbox_jobs(organization_id,sync_job_id,attempt_number,retry_idempotency_key,provider_idempotency_key,item_keys,request_digest)
    values(p_organization_id,created_job,1,p_idempotency_key,'integration:'||created_job::text||':1',keys,preview.source_digest);
  end if;
  update public.integration_export_previews set consumed_at=clock_timestamp(),sync_job_id=created_job,
    expires_at=greatest(expires_at,clock_timestamp()+interval '7 days'),
    stage=case when cardinality(keys)=0 then 'redacted' else stage end,
    roster_snapshot=case when cardinality(keys)=0 then '{}'::jsonb else roster_snapshot end,
    provider_confirmation_token=case when cardinality(keys)=0 then null else provider_confirmation_token end,
    redacted_at=case when cardinality(keys)=0 then clock_timestamp() else null end where id=preview.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'integration.roster_export_confirmed','integration_sync_job',created_job);
  return (case when cardinality(keys)=0 then 'completed' else 'queued' end,created_job,
    case when cardinality(keys)=0 then 'completed' else 'pending' end,cardinality(keys),0,0,0)::public.integration_export_confirmation_v2_result;
end $$;

create type public.integration_retry_v2_result as (
  outcome text,job_id uuid,state text,retried_item_count integer,preserved_completed_item_count integer,preserved_skipped_item_count integer
);

create function public.retry_integration_sync_job_v2(p_organization_id uuid,p_job_id uuid,p_idempotency_key text)
returns public.integration_retry_v2_result language plpgsql security definer set search_path='' as $$
declare target public.integration_sync_jobs%rowtype; prior public.integration_outbox_jobs%rowtype; keys text[];
  retry_count integer; completed_count integer; skipped_count integer; next_attempt integer;
begin
  if not private.can_manage_integrations(p_organization_id) then return ('forbidden',null,null,0,0,0)::public.integration_retry_v2_result; end if;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$' then return ('invalid_input',null,null,0,0,0)::public.integration_retry_v2_result; end if;
  perform pg_advisory_xact_lock(hashtextextended('integration-retry:'||p_organization_id::text||':'||p_job_id::text||':'||p_idempotency_key,0));
  select * into target from public.integration_sync_jobs where organization_id=p_organization_id and id=p_job_id for update;
  if not found then return ('not_found',null,null,0,0,0)::public.integration_retry_v2_result; end if;
  if target.created_by_user_id<>auth.uid() then return ('forbidden',null,null,0,0,0)::public.integration_retry_v2_result; end if;
  select * into prior from public.integration_outbox_jobs where organization_id=p_organization_id and sync_job_id=p_job_id and retry_idempotency_key=p_idempotency_key;
  select count(*) filter(where state='completed'),count(*) filter(where state='skipped') into completed_count,skipped_count
    from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=p_job_id;
  if found and prior.id is not null then
    if prior.request_digest=target.request_digest then
      return ('replayed',p_job_id,target.state,cardinality(prior.item_keys),completed_count,skipped_count)::public.integration_retry_v2_result;
    end if;
    return ('conflict',null,null,0,0,0)::public.integration_retry_v2_result;
  end if;
  if target.state='needs_attention' then return ('manual_attention_required',p_job_id,target.state,0,completed_count,skipped_count)::public.integration_retry_v2_result; end if;
  if target.state not in ('failed','partially_completed') then return ('nothing_to_retry',p_job_id,target.state,0,completed_count,skipped_count)::public.integration_retry_v2_result; end if;
  select array_agg(item_key order by item_key),count(*) into keys,retry_count from public.integration_sync_items
    where organization_id=p_organization_id and sync_job_id=p_job_id and state in ('failed','requires_review') and retry_eligible;
  if coalesce(retry_count,0)=0 then return ('nothing_to_retry',p_job_id,target.state,0,completed_count,skipped_count)::public.integration_retry_v2_result; end if;
  select coalesce(max(attempt_number),0)+1 into next_attempt from public.integration_outbox_jobs where organization_id=p_organization_id and sync_job_id=p_job_id;
  if next_attempt>100 then return ('conflict',null,null,0,0,0)::public.integration_retry_v2_result; end if;
  update public.integration_sync_items set state='pending',normalized_error=null,completed_at=null,retry_eligible=false
    where organization_id=p_organization_id and sync_job_id=p_job_id and item_key=any(keys) and retry_eligible;
  update public.integration_sync_jobs set state='pending',completed_at=null,attention_required_at=null,last_error=null where id=p_job_id;
  insert into public.integration_outbox_jobs(organization_id,sync_job_id,attempt_number,retry_idempotency_key,provider_idempotency_key,item_keys,request_digest)
    values(p_organization_id,p_job_id,next_attempt,p_idempotency_key,'integration:'||p_job_id::text||':'||next_attempt,keys,target.request_digest);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'integration.sync_retried','integration_sync_job',p_job_id);
  return ('queued',p_job_id,'pending',retry_count,completed_count,skipped_count)::public.integration_retry_v2_result;
end $$;

create function public.save_roster_export_preview_v2(
  p_organization_id uuid,p_source_id uuid,p_source_digest text,p_provider_preview_id text,p_confirmation_token text,p_preview jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare source public.integration_export_previews%rowtype; item jsonb; athlete jsonb; expected_fields jsonb; team_name text;
begin
  if not private.can_manage_integrations(p_organization_id) then return 'forbidden'; end if;
  select * into source from public.integration_export_previews where organization_id=p_organization_id and id=p_source_id for update;
  if not found or source.created_by_user_id<>auth.uid() then return 'not_found'; end if;
  if source.stage='ready' then return case when source.source_digest=p_source_digest and source.provider_preview_id=p_provider_preview_id then 'replayed' else 'conflict' end; end if;
  if source.stage<>'source' or source.expires_at<=clock_timestamp() then return 'stale'; end if;
  if source.source_digest<>p_source_digest or p_provider_preview_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_confirmation_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$' or jsonb_typeof(p_preview)<>'object'
    or p_preview->>'previewId' is distinct from p_provider_preview_id or p_preview->>'confirmationToken' is distinct from p_confirmation_token
    or (p_preview->>'snapshotDigest') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_preview->'items')<>'array'
    or jsonb_array_length(p_preview->'items')<>jsonb_array_length(source.roster_snapshot->'athletes') then return 'conflict'; end if;
  for item in select value from jsonb_array_elements(p_preview->'items') loop
    select value into athlete from jsonb_array_elements(source.roster_snapshot->'athletes') where value->>'registrationId'=item->>'registrationId';
    if athlete is null or item->>'itemKey'<>'athlete:'||(athlete->>'registrationId') then return 'conflict'; end if;
    select team->>'name' into team_name from jsonb_array_elements(source.roster_snapshot->'teams') team where team->>'id'=athlete->>'teamId';
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
    provider_snapshot_digest=p_preview->>'snapshotDigest',preview_snapshot=p_preview,stage='ready' where id=source.id;
  return 'created';
end $$;

create or replace function public.claim_integration_outbox_jobs(p_lease_owner text,p_batch_size integer,p_lease_seconds integer)
returns setof public.claimed_integration_outbox_job language plpgsql security definer set search_path='' as $$
declare candidate public.integration_outbox_jobs%rowtype; target public.integration_outbox_jobs%rowtype;
  sync public.integration_sync_jobs%rowtype; preview public.integration_export_previews%rowtype;
  result public.claimed_integration_outbox_job; handled integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$' or p_batch_size not between 1 and 50 or p_lease_seconds not between 30 and 300
    then raise exception 'invalid job claim' using errcode='22023'; end if;
  for candidate in select * from public.integration_outbox_jobs job where job.status in ('pending','leased')
    and job.available_at<=clock_timestamp() and (job.status='pending' or job.lease_expires_at<=clock_timestamp())
    order by job.available_at,job.created_at,job.id limit p_batch_size*2
  loop
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.status not in ('pending','leased') or target.available_at>clock_timestamp()
      or (target.status='leased' and target.lease_expires_at>clock_timestamp()) then continue; end if;
    handled:=handled+1;
    if target.status='leased' and target.provider_submission_started_at is not null then
      update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',lease_owner=null,
        lease_token=null,lease_expires_at=null,dead_lettered_at=clock_timestamp() where id=target.id;
      update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),last_error='{"code":"delivery_uncertain","retryable":false}' where id=target.sync_job_id;
      update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false
        where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys) and state not in ('completed','skipped');
      update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp()
        where sync_job_id=target.sync_job_id and stage<>'redacted';
      if handled>=p_batch_size then return; end if; continue;
    end if;
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id;
    select * into preview from public.integration_export_previews where id=sync.source_preview_id;
    if sync.id is null or preview.id is null or preview.stage<>'ready' then
      update public.integration_outbox_jobs set status='cancelled',last_error_code='source_invalid',cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp(),last_error='{"code":"source_invalid","retryable":false}' where id=target.sync_job_id;
      update public.integration_sync_items set state='cancelled',normalized_error='{"code":"source_invalid","retryable":false}',retry_eligible=false where sync_job_id=target.sync_job_id and state not in ('completed','skipped');
      if handled>=p_batch_size then return; end if; continue;
    end if;
    update public.integration_outbox_jobs set status='leased',attempt_count=attempt_count+1,lease_owner=p_lease_owner,
      lease_token=gen_random_uuid(),lease_generation=lease_generation+1,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null
      where id=target.id returning * into target;
    update public.integration_sync_items set state='processing',attempts=attempts+1 where organization_id=target.organization_id
      and sync_job_id=target.sync_job_id and item_key=any(target.item_keys) and state='pending';
    update public.integration_sync_jobs set state='processing' where id=sync.id;
    result:=(target.id,target.sync_job_id,target.organization_id,sync.connection_id,sync.provider_key,sync.created_by_user_id,
      target.lease_token,target.lease_generation,target.lease_expires_at,target.provider_idempotency_key,target.attempt_number,target.item_keys,
      jsonb_build_object('destination',sync.destination_snapshot,'approvedFields',sync.approved_fields,
        'roster',jsonb_set(preview.roster_snapshot,'{athletes}',coalesce((select jsonb_agg(athlete order by athlete->>'registrationId')
          from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete where 'athlete:'||(athlete->>'registrationId')=any(target.item_keys)),'[]'::jsonb)),
        'previewId',sync.provider_preview_id,'confirmationToken',preview.provider_confirmation_token));
    return next result;
    if handled>=p_batch_size then return; end if;
  end loop;
end $$;

create function private.check_integration_outbox_execution(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_mark_submission boolean
) returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype; sync public.integration_sync_jobs%rowtype;
begin
  select * into target from public.integration_outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation
    or target.lease_expires_at<=clock_timestamp() then return 'lease_conflict'; end if;
  select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
  if not exists(select 1 from public.organization_members member where member.organization_id=sync.organization_id
      and member.user_id=sync.created_by_user_id and member.status='active' and member.role in ('owner','administrator'))
    or not exists(select 1 from public.integration_connections connection where connection.organization_id=sync.organization_id
      and connection.id=sync.connection_id and connection.created_by_user_id=sync.created_by_user_id and connection.state='connected')
    or not exists(select 1 from public.roster_versions roster where roster.organization_id=sync.organization_id
      and roster.id=sync.roster_version_id and roster.state='finalized' and roster.version=sync.roster_version)
    or not exists(select 1 from public.integration_export_previews preview where preview.organization_id=sync.organization_id
      and preview.id=sync.source_preview_id and preview.stage='ready' and preview.source_digest=sync.request_digest)
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
    update public.integration_outbox_jobs set provider_submission_started_at=coalesce(provider_submission_started_at,clock_timestamp()) where id=p_job_id;
  end if;
  return 'authorized';
end $$;

create function public.validate_integration_outbox_execution(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint)
returns text language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  return private.check_integration_outbox_execution(p_job_id,p_lease_token,p_lease_generation,false);
end $$;

create or replace function public.authorize_integration_outbox_submission(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint)
returns text language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  return private.check_integration_outbox_execution(p_job_id,p_lease_token,p_lease_generation,true);
end $$;

alter function public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb) rename to complete_integration_outbox_job_legacy_077;
create function public.complete_integration_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_external_job_id text,p_result jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype; sync public.integration_sync_jobs%rowtype; preview public.integration_export_previews%rowtype;
  proof jsonb; expected integer; outcome text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select * into target from public.integration_outbox_jobs where id=p_job_id;
  if not found then return 'not_found'; end if;
  select * into sync from public.integration_sync_jobs where id=target.sync_job_id;
  select * into preview from public.integration_export_previews where id=sync.source_preview_id;
  if jsonb_typeof(p_result->'entityMappings')<>'array' then raise exception 'invalid mapping proof' using errcode='22023'; end if;
  expected:=jsonb_array_length(preview.roster_snapshot->'teams')+1;
  if jsonb_array_length(p_result->'entityMappings')<>expected then raise exception 'incomplete mapping proof' using errcode='22023'; end if;
  if (select count(distinct (mapping->>'entityType',mapping->>'internalEntityId'))
      from jsonb_array_elements(p_result->'entityMappings') mapping)<>expected
    or (select count(*) from jsonb_array_elements(p_result->'entityMappings') mapping
        where mapping->>'entityType'='roster_version'
          and mapping->>'internalEntityId'=sync.roster_version_id::text)<>1
    or exists(
      select 1 from jsonb_array_elements(preview.roster_snapshot->'teams') team
      where not exists(
        select 1 from jsonb_array_elements(p_result->'entityMappings') mapping
        where mapping->>'entityType'='team' and mapping->>'internalEntityId'=team->>'id'
      )
    )
  then raise exception 'incomplete mapping proof' using errcode='22023'; end if;
  for proof in
    select value from jsonb_array_elements(p_result->'entityMappings')
    order by value->>'entityType',value->>'internalEntityId'
  loop
    if proof->>'entityType' not in ('team','roster_version') or (proof->>'internalEntityId') !~ '^[0-9a-f-]{36}$'
      or proof->'externalRef'->>'entityType'<>proof->>'entityType' or proof->'externalRef'->>'providerKey'<>sync.provider_key
      or coalesce((proof->'externalRef'->>'mockData')::boolean,not sync.mock_data)<>sync.mock_data
      or not ((proof->>'entityType'='roster_version' and (proof->>'internalEntityId')::uuid=sync.roster_version_id)
        or (proof->>'entityType'='team' and exists(select 1 from jsonb_array_elements(preview.roster_snapshot->'teams') team where team->>'id'=proof->>'internalEntityId')))
    then raise exception 'invalid mapping proof' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended('integration-map:'||sync.organization_id||':'||sync.connection_id||':'||(proof->>'entityType')||':'||(proof->>'internalEntityId'),0));
  end loop;
  outcome:=public.complete_integration_outbox_job_legacy_077(p_job_id,p_lease_token,p_lease_generation,p_external_job_id,p_result);
  if outcome not in ('completed','replayed') then return outcome; end if;
  for proof in
    select value from jsonb_array_elements(p_result->'entityMappings')
    order by value->>'entityType',value->>'internalEntityId'
  loop
    insert into public.external_entity_mappings(organization_id,connection_id,provider_key,entity_type,internal_entity_id,external_id,external_ref,first_sync_job_id,last_sync_job_id)
    values(sync.organization_id,sync.connection_id,sync.provider_key,proof->>'entityType',(proof->>'internalEntityId')::uuid,
      proof->'externalRef'->>'externalId',proof->'externalRef',sync.id,sync.id)
    on conflict(organization_id,connection_id,entity_type,internal_entity_id) do update set external_ref=excluded.external_ref,last_sync_job_id=excluded.last_sync_job_id
      where external_entity_mappings.external_id=excluded.external_id;
  end loop;
  update public.integration_sync_items set retry_eligible=state in ('failed','requires_review') where organization_id=sync.organization_id and sync_job_id=sync.id;
  if (select state='completed' from public.integration_sync_jobs where id=sync.id) then
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=sync.source_preview_id;
  end if;
  return outcome;
end $$;

alter function public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean) rename to fail_integration_outbox_job_legacy_077;
create function public.fail_integration_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_error_code text,p_retryable boolean)
returns text language plpgsql security definer set search_path='' as $$
declare outcome text; sync_id uuid; preview_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select outbox.sync_job_id,sync.source_preview_id into sync_id,preview_id from public.integration_outbox_jobs outbox
    join public.integration_sync_jobs sync on sync.id=outbox.sync_job_id where outbox.id=p_job_id;
  outcome:=public.fail_integration_outbox_job_legacy_077(p_job_id,p_lease_token,p_lease_generation,p_error_code,p_retryable);
  if outcome in ('needs_attention','dead_lettered') then
    update public.integration_sync_items set retry_eligible=false where sync_job_id=sync_id;
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp() where id=preview_id and stage<>'redacted';
  end if;
  return outcome;
end $$;

create function public.purge_expired_integration_previews(p_limit integer) returns integer language plpgsql security definer set search_path='' as $$
declare affected integer:=0;
begin
  if auth.role()<>'service_role' or p_limit not between 1 and 500 then raise exception 'forbidden' using errcode='42501'; end if;
  with doomed as (select id from public.integration_export_previews where expires_at<=clock_timestamp() and sync_job_id is null order by expires_at,id limit p_limit)
  delete from public.integration_export_previews where id in(select id from doomed);
  get diagnostics affected=row_count;
  update public.integration_export_previews preview set stage='redacted',roster_snapshot='{}',provider_confirmation_token=null,redacted_at=clock_timestamp()
    from public.integration_sync_jobs sync where preview.sync_job_id=sync.id and preview.stage<>'redacted' and sync.state in ('completed','cancelled','needs_attention');
  return affected;
end $$;

revoke all on function public.issue_roster_export_source(uuid,uuid,uuid,jsonb,text[]),public.save_roster_export_preview_v2(uuid,uuid,text,text,text,jsonb),
  public.confirm_roster_export_preview_v2(uuid,text,text,text),public.retry_integration_sync_job_v2(uuid,uuid,text),public.purge_expired_integration_previews(integer),
  public.validate_integration_outbox_execution(uuid,uuid,bigint),public.complete_integration_outbox_job_legacy_077(uuid,uuid,bigint,text,jsonb),
  public.fail_integration_outbox_job_legacy_077(uuid,uuid,bigint,text,boolean)
from public,anon,authenticated,service_role;
revoke all on function public.save_roster_export_preview(uuid,uuid,uuid,jsonb,text[],text,text,text,jsonb,text),
  public.confirm_roster_export_preview(uuid,text,text,text),public.retry_integration_sync_job(uuid,uuid,text)
from public,anon,authenticated,service_role;
revoke select on table public.integration_export_previews from authenticated;
revoke all on function private.bind_integration_preview_source_digest() from public,anon,authenticated,service_role;
revoke all on function private.bind_integration_outbox_request_digest() from public,anon,authenticated,service_role;
revoke all on function private.check_integration_outbox_execution(uuid,uuid,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.issue_roster_export_source(uuid,uuid,uuid,jsonb,text[]),public.save_roster_export_preview_v2(uuid,uuid,text,text,text,jsonb),
  public.confirm_roster_export_preview_v2(uuid,text,text,text),public.retry_integration_sync_job_v2(uuid,uuid,text) to authenticated;
grant execute on function public.purge_expired_integration_previews(integer),public.claim_integration_outbox_jobs(text,integer,integer),
  public.validate_integration_outbox_execution(uuid,uuid,bigint),public.authorize_integration_outbox_submission(uuid,uuid,bigint),public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb),
  public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean) to service_role;
