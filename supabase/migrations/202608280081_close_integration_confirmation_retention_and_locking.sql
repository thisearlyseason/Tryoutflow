-- Close the remaining confirmation, redaction, upgrade-safety, retry-projection,
-- and dynamic lock-set gaps without rewriting integration migration history.

-- Redaction is a column contract, not a stage label. Repair rows that were
-- already labelled redacted before strengthening the lifecycle constraint.
update public.integration_export_previews
set roster_snapshot='{}'::jsonb,
  preview_snapshot=null,
  provider_confirmation_token=null,
  redacted_at=coalesce(redacted_at,clock_timestamp())
where stage='redacted'
  and (
    roster_snapshot<>'{}'::jsonb
    or preview_snapshot is not null
    or provider_confirmation_token is not null
    or redacted_at is null
  );

alter table public.integration_export_previews
  drop constraint integration_export_previews_stage_shape_check;
alter table public.integration_export_previews
  add constraint integration_export_previews_stage_shape_check check(
    (stage='source'
      and provider_preview_id is null
      and provider_confirmation_token is null
      and preview_snapshot is null
      and redacted_at is null)
    or (stage='ready'
      and provider_preview_id is not null
      and provider_confirmation_token is not null
      and preview_snapshot is not null
      and redacted_at is null)
    or (stage='redacted'
      and provider_confirmation_token is null
      and roster_snapshot='{}'::jsonb
      and preview_snapshot is null
      and redacted_at is not null)
  );

create function private.enforce_integration_preview_redaction()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.stage='redacted' then
    new.roster_snapshot:='{}'::jsonb;
    new.preview_snapshot:=null;
    new.provider_confirmation_token:=null;
    new.redacted_at:=coalesce(new.redacted_at,clock_timestamp());
  end if;
  return new;
end $$;

create trigger enforce_integration_preview_redaction
before insert or update on public.integration_export_previews
for each row execute function private.enforce_integration_preview_redaction();

-- The 077 payload columns are obsolete. Sanitize historical values and prevent
-- any compatibility insert from reintroducing raw roster/token bytes.
update public.integration_sync_jobs
set roster_snapshot=null,provider_confirmation_token=null
where roster_snapshot is not null or provider_confirmation_token is not null;

alter table public.integration_sync_jobs
  add constraint integration_sync_jobs_legacy_payload_check
  check(roster_snapshot is null and provider_confirmation_token is null);

create function private.clear_integration_sync_legacy_payload()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.roster_snapshot:=null;
  new.provider_confirmation_token:=null;
  return new;
end $$;

create trigger clear_integration_sync_legacy_payload
before insert or update on public.integration_sync_jobs
for each row execute function private.clear_integration_sync_legacy_payload();

-- Every operation touching a sync job uses this stable serialization key before
-- entering a row-lock set. It prevents retry from inserting a new outbox row
-- while purge/claim/authorization/completion/failure snapshot that set.
create function private.lock_integration_sync_job(p_sync_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_sync_job_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('integration-sync:'||p_sync_job_id::text,0)
    );
  end if;
end $$;

create function private.redact_integration_sync_payload(p_sync_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_sync_job_id is null then return; end if;
  update public.integration_export_previews
  set stage='redacted',roster_snapshot='{}'::jsonb,preview_snapshot=null,
    provider_confirmation_token=null,redacted_at=coalesce(redacted_at,clock_timestamp())
  where sync_job_id=p_sync_job_id;
  update public.integration_sync_jobs
  set roster_snapshot=null,provider_confirmation_token=null,approved_projection='[]'::jsonb
  where id=p_sync_job_id;
end $$;

-- Bounded history repair deliberately excludes every active unexpired lease.
-- Those rows remain usable until the accepted receipt completes or the lease
-- expires, after which the runtime purge can process them.
create function private.repair_integration_sensitive_history(p_limit integer)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; affected integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid repair limit' using errcode='22023';
  end if;
  for candidate in
    select preview.id preview_id,preview.sync_job_id
    from public.integration_export_previews preview
    left join public.integration_sync_jobs sync on sync.id=preview.sync_job_id
    where (
      (preview.stage='redacted' and (
        preview.roster_snapshot<>'{}'::jsonb
        or preview.preview_snapshot is not null
        or preview.provider_confirmation_token is not null
      ))
      or (sync.id is not null and (
        sync.roster_snapshot is not null
        or sync.provider_confirmation_token is not null
        or (sync.approved_projection<>'[]'::jsonb and (
          preview.stage='redacted'
          or sync.state in ('completed','cancelled','needs_attention')
          or (sync.state in ('failed','partially_completed') and not exists(
            select 1 from public.integration_sync_items retryable
            where retryable.sync_job_id=sync.id and retryable.retry_eligible
          ))
        ))
      ))
    )
    and not exists(
      select 1 from public.integration_outbox_jobs active
      where active.sync_job_id=preview.sync_job_id
        and active.status='leased'
        and active.lease_expires_at>clock_timestamp()
    )
    order by preview.created_at,preview.id
    limit p_limit
  loop
    if candidate.sync_job_id is null then
      update public.integration_export_previews
      set stage='redacted',roster_snapshot='{}'::jsonb,preview_snapshot=null,
        provider_confirmation_token=null,redacted_at=coalesce(redacted_at,clock_timestamp())
      where id=candidate.preview_id;
    else
      perform private.lock_integration_sync_job(candidate.sync_job_id);
      if exists(
        select 1 from public.integration_outbox_jobs active
        where active.sync_job_id=candidate.sync_job_id
          and active.status='leased'
          and active.lease_expires_at>clock_timestamp()
      ) then
        continue;
      end if;
      perform private.redact_integration_sync_payload(candidate.sync_job_id);
    end if;
    affected:=affected+1;
  end loop;
  return affected;
end $$;

do $$
declare repaired integer;
begin
  loop
    repaired:=private.repair_integration_sensitive_history(500);
    exit when repaired=0;
  end loop;
end $$;

create type public.integration_export_confirmation_v4_result as (
  outcome text,job_id uuid,state text,item_count integer,completed_count integer,
  skipped_count integer,failed_count integer,retry_eligible_count integer
);

create function public.confirm_roster_export_preview_v4(
  p_organization_id uuid,p_provider_preview_id text,p_source_digest text,
  p_confirmation_token text,p_idempotency_key text
) returns public.integration_export_confirmation_v4_result
language plpgsql security definer set search_path='' as $$
declare preview public.integration_export_previews%rowtype;
  existing public.integration_sync_jobs%rowtype;
  prior public.integration_export_confirmation_v2_result;
  token_digest text;item_count integer:=0;completed_count integer:=0;
  skipped_count integer:=0;failed_count integer:=0;eligible_count integer:=0;
begin
  -- NULL must fail before digesting, locking, or mutating anything.
  if p_organization_id is null
    or p_provider_preview_id is null
    or p_source_digest is null
    or p_confirmation_token is null
    or p_idempotency_key is null
    or p_provider_preview_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_source_digest !~ '^[0-9a-f]{64}$'
    or p_confirmation_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
  then
    return ('invalid_input',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  if not private.can_manage_integrations(p_organization_id) then
    return ('forbidden',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  token_digest:=encode(extensions.digest(p_confirmation_token,'sha256'),'hex');
  select * into preview
  from public.integration_export_previews candidate
  where candidate.organization_id=p_organization_id
    and candidate.provider_preview_id=p_provider_preview_id;
  if not found or preview.created_by_user_id is distinct from auth.uid() then
    return ('not_found',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  if preview.organization_id is distinct from p_organization_id
    or preview.provider_preview_id is distinct from p_provider_preview_id
    or preview.connection_id is null
    or preview.source_digest is distinct from p_source_digest
  then
    return ('conflict',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'integration-confirm:'||p_organization_id::text||':'||preview.connection_id::text||':'||p_idempotency_key,0
  ));
  select * into preview
  from public.integration_export_previews candidate
  where candidate.id=preview.id for update;
  if not found
    or preview.organization_id is distinct from p_organization_id
    or preview.created_by_user_id is distinct from auth.uid()
    or preview.provider_preview_id is distinct from p_provider_preview_id
    or preview.connection_id is null
    or preview.source_digest is distinct from p_source_digest
  then
    return ('conflict',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  select * into existing
  from public.integration_sync_jobs candidate
  where candidate.organization_id=p_organization_id
    and candidate.connection_id=preview.connection_id
    and candidate.business_idempotency_key=p_idempotency_key;
  if found then
    if existing.organization_id is distinct from p_organization_id
      or existing.connection_id is distinct from preview.connection_id
      or existing.created_by_user_id is distinct from auth.uid()
      or existing.source_preview_id is distinct from preview.id
      or existing.provider_preview_id is distinct from p_provider_preview_id
      or existing.request_digest is distinct from p_source_digest
      or preview.source_digest is distinct from p_source_digest
      or existing.confirmation_token_digest is distinct from token_digest
      or preview.sync_job_id is distinct from existing.id
      or preview.consumed_at is null
    then
      return ('conflict',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
    end if;
    select count(*)::integer,
      count(*) filter(where state='completed')::integer,
      count(*) filter(where state='skipped')::integer,
      count(*) filter(where state in ('failed','requires_review'))::integer,
      count(*) filter(where state in ('failed','requires_review') and retry_eligible)::integer
    into item_count,completed_count,skipped_count,failed_count,eligible_count
    from public.integration_sync_items
    where organization_id=p_organization_id and sync_job_id=existing.id;
    return ('replayed',existing.id,existing.state,item_count,completed_count,
      skipped_count,failed_count,eligible_count)::public.integration_export_confirmation_v4_result;
  end if;
  if preview.stage<>'ready' or preview.consumed_at is not null then
    return ('already_consumed',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  if preview.expires_at<=clock_timestamp() then
    return ('stale',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  if preview.provider_confirmation_token is distinct from p_confirmation_token then
    return ('conflict',null,null,0,0,0,0,0)::public.integration_export_confirmation_v4_result;
  end if;
  prior:=public.confirm_roster_export_preview_v2(
    p_organization_id,p_provider_preview_id,p_confirmation_token,p_idempotency_key
  );
  if prior.outcome not in ('queued','completed') or prior.job_id is null then
    return (prior.outcome,prior.job_id,prior.state,prior.item_count,prior.completed_count,
      prior.skipped_count,prior.failed_count,0)::public.integration_export_confirmation_v4_result;
  end if;
  select * into existing from public.integration_sync_jobs where id=prior.job_id;
  if existing.organization_id is distinct from p_organization_id
    or existing.connection_id is distinct from preview.connection_id
    or existing.created_by_user_id is distinct from auth.uid()
    or existing.source_preview_id is distinct from preview.id
    or existing.request_digest is distinct from p_source_digest
    or preview.source_digest is distinct from p_source_digest
    or existing.confirmation_token_digest is distinct from token_digest
  then
    raise exception 'confirmation invariant failed' using errcode='23514';
  end if;
  if prior.outcome='completed' then
    perform private.redact_integration_sync_payload(prior.job_id);
  end if;
  select count(*)::integer,
    count(*) filter(where state='completed')::integer,
    count(*) filter(where state='skipped')::integer,
    count(*) filter(where state in ('failed','requires_review'))::integer,
    count(*) filter(where state in ('failed','requires_review') and retry_eligible)::integer
  into item_count,completed_count,skipped_count,failed_count,eligible_count
  from public.integration_sync_items
  where organization_id=p_organization_id and sync_job_id=prior.job_id;
  return (prior.outcome,prior.job_id,existing.state,item_count,completed_count,
    skipped_count,failed_count,eligible_count)::public.integration_export_confirmation_v4_result;
end $$;

create type public.integration_retry_v4_result as (
  outcome text,job_id uuid,state text,retried_item_count integer,
  preserved_completed_item_count integer,preserved_skipped_item_count integer,
  completed_count integer,skipped_count integer,failed_count integer,retry_eligible_count integer
);

create function public.retry_integration_sync_job_v4(
  p_organization_id uuid,p_job_id uuid,p_idempotency_key text
) returns public.integration_retry_v4_result
language plpgsql security definer set search_path='' as $$
declare prior public.integration_retry_v2_result;durable_state text;
  completed_count integer:=0;skipped_count integer:=0;failed_count integer:=0;eligible_count integer:=0;
begin
  if not private.can_manage_integrations(p_organization_id) then
    return ('forbidden',null,null,0,0,0,0,0,0,0)::public.integration_retry_v4_result;
  end if;
  if p_organization_id is null or p_job_id is null or p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
  then
    return ('invalid_input',null,null,0,0,0,0,0,0,0)::public.integration_retry_v4_result;
  end if;
  perform private.lock_integration_sync_job(p_job_id);
  prior:=public.retry_integration_sync_job_v2(p_organization_id,p_job_id,p_idempotency_key);
  if prior.job_id is not null then
    select state into durable_state from public.integration_sync_jobs
    where organization_id=p_organization_id and id=prior.job_id and created_by_user_id=auth.uid();
    if durable_state is null then
      return ('forbidden',null,null,0,0,0,0,0,0,0)::public.integration_retry_v4_result;
    end if;
    select count(*) filter(where state='completed')::integer,
      count(*) filter(where state='skipped')::integer,
      count(*) filter(where state in ('failed','requires_review'))::integer,
      count(*) filter(where state in ('failed','requires_review') and retry_eligible)::integer
    into completed_count,skipped_count,failed_count,eligible_count
    from public.integration_sync_items
    where organization_id=p_organization_id and sync_job_id=prior.job_id;
  end if;
  return (prior.outcome,prior.job_id,coalesce(durable_state,prior.state),prior.retried_item_count,
    prior.preserved_completed_item_count,prior.preserved_skipped_item_count,completed_count,
    skipped_count,failed_count,eligible_count)::public.integration_retry_v4_result;
end $$;

create or replace function private.check_integration_outbox_execution(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_mark_submission boolean
) returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype;sync public.integration_sync_jobs%rowtype;
  member public.organization_members%rowtype;connection public.integration_connections%rowtype;
  roster public.roster_versions%rowtype;preview public.integration_export_previews%rowtype;
  sync_id uuid;
begin
  select candidate.sync_job_id into sync_id
  from public.integration_outbox_jobs candidate where candidate.id=p_job_id;
  if sync_id is null then return 'not_found'; end if;
  perform private.lock_integration_sync_job(sync_id);
  select * into target from public.integration_outbox_jobs where id=p_job_id for update;
  if not found or target.sync_job_id is distinct from sync_id then return 'not_found'; end if;
  if target.status<>'leased'
    or target.lease_token is distinct from p_lease_token
    or target.lease_generation is distinct from p_lease_generation
  then return 'lease_conflict'; end if;
  select * into sync from public.integration_sync_jobs
  where organization_id=target.organization_id and id=target.sync_job_id for update;
  if sync.id is null then return 'lease_conflict'; end if;
  if target.lease_expires_at<=clock_timestamp() then
    if target.provider_submission_started_at is null then return 'lease_conflict'; end if;
    update public.integration_outbox_jobs
    set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),
      lease_owner=null,lease_token=null,lease_expires_at=null
    where id=target.id;
    update public.integration_sync_jobs
    set state='needs_attention',attention_required_at=clock_timestamp(),
      last_error='{"code":"delivery_uncertain","retryable":false}'::jsonb
    where id=sync.id;
    update public.integration_sync_items
    set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}'::jsonb,
      retry_eligible=false
    where organization_id=sync.organization_id and sync_job_id=sync.id
      and state not in ('completed','skipped');
    perform private.redact_integration_sync_payload(sync.id);
    return 'delivery_uncertain';
  end if;
  -- Stable row order after the advisory key: membership, connection, roster, source.
  select * into member from public.organization_members candidate
  where candidate.organization_id=sync.organization_id and candidate.user_id=sync.created_by_user_id for share;
  select * into connection from public.integration_connections candidate
  where candidate.organization_id=sync.organization_id and candidate.id=sync.connection_id for share;
  select * into roster from public.roster_versions candidate
  where candidate.organization_id=sync.organization_id and candidate.id=sync.roster_version_id for share;
  select * into preview from public.integration_export_previews candidate
  where candidate.organization_id=sync.organization_id and candidate.id=sync.source_preview_id for share;
  if member.user_id is null or member.status<>'active' or member.role not in ('owner','administrator')
    or connection.id is null or connection.created_by_user_id is distinct from sync.created_by_user_id
      or connection.state<>'connected'
    or roster.id is null or roster.state<>'finalized' or roster.version is distinct from sync.roster_version
    or preview.id is null or preview.stage<>'ready' or preview.source_digest is distinct from sync.request_digest
    -- Expiry prevents a new handoff. Once the handoff marker exists, an otherwise
    -- valid unexpired lease may deliver its exact accepted provider receipt.
    or (target.provider_submission_started_at is null and preview.expires_at<=clock_timestamp())
  then
    if target.provider_submission_started_at is not null then
      update public.integration_outbox_jobs
      set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),
        lease_owner=null,lease_token=null,lease_expires_at=null
      where id=target.id;
      update public.integration_sync_jobs
      set state='needs_attention',attention_required_at=clock_timestamp(),
        last_error='{"code":"delivery_uncertain","retryable":false}'::jsonb
      where id=sync.id;
      update public.integration_sync_items
      set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}'::jsonb,
        retry_eligible=false
      where organization_id=sync.organization_id and sync_job_id=sync.id
        and state not in ('completed','skipped');
      perform private.redact_integration_sync_payload(sync.id);
      return 'delivery_uncertain';
    end if;
    update public.integration_outbox_jobs
    set status='cancelled',last_error_code='authorization_revoked',cancelled_at=clock_timestamp(),
      lease_owner=null,lease_token=null,lease_expires_at=null
    where id=target.id;
    update public.integration_sync_jobs
    set state='cancelled',cancelled_at=clock_timestamp(),
      last_error='{"code":"authorization_revoked","retryable":false}'::jsonb
    where id=sync.id;
    update public.integration_sync_items
    set state='cancelled',normalized_error='{"code":"authorization_revoked","retryable":false}'::jsonb,
      retry_eligible=false
    where organization_id=sync.organization_id and sync_job_id=sync.id
      and state not in ('completed','skipped');
    perform private.redact_integration_sync_payload(sync.id);
    return 'authorization_revoked';
  end if;
  if p_mark_submission then
    update public.integration_outbox_jobs
    set provider_submission_started_at=coalesce(provider_submission_started_at,clock_timestamp())
    where id=p_job_id;
  end if;
  return 'authorized';
end $$;

create or replace function public.claim_integration_outbox_jobs(
  p_lease_owner text,p_batch_size integer,p_lease_seconds integer
) returns setof public.claimed_integration_outbox_job
language plpgsql security definer set search_path='' as $$
declare candidate public.integration_outbox_jobs%rowtype;target public.integration_outbox_jobs%rowtype;
  sync public.integration_sync_jobs%rowtype;preview public.integration_export_previews%rowtype;
  result public.claimed_integration_outbox_job;returned integer:=0;
  total_items integer;successful_items integer;failed_items integer;derived_state text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner is null or p_batch_size is null or p_lease_seconds is null
    or p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$'
    or p_batch_size not between 1 and 50 or p_lease_seconds not between 30 and 300
  then raise exception 'invalid job claim' using errcode='22023'; end if;
  -- Terminalization is bounded independently so poison cannot hide healthy work.
  for candidate in
    select * from public.integration_outbox_jobs job
    where job.status='leased' and job.lease_expires_at<=clock_timestamp()
      and (job.provider_submission_started_at is not null or job.attempt_count>=job.max_attempts)
    order by job.available_at,job.created_at,job.id limit p_batch_size
  loop
    perform private.lock_integration_sync_job(candidate.sync_job_id);
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.sync_job_id is distinct from candidate.sync_job_id
      or target.status<>'leased' or target.lease_expires_at>clock_timestamp()
    then continue; end if;
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
    if target.provider_submission_started_at is not null then
      update public.integration_outbox_jobs
      set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),
        lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs
      set state='needs_attention',attention_required_at=clock_timestamp(),
        last_error='{"code":"delivery_uncertain","retryable":false}'::jsonb where id=sync.id;
      update public.integration_sync_items
      set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}'::jsonb,
        retry_eligible=false
      where organization_id=target.organization_id and sync_job_id=target.sync_job_id
        and item_key=any(target.item_keys) and state not in ('completed','skipped');
    else
      update public.integration_outbox_jobs
      set status='dead_letter',last_error_code='attempts_exhausted',dead_lettered_at=clock_timestamp(),
        lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_items
      set state='failed',normalized_error='{"code":"attempts_exhausted","retryable":false}'::jsonb,
        retry_eligible=false
      where organization_id=target.organization_id and sync_job_id=target.sync_job_id
        and item_key=any(target.item_keys) and state not in ('completed','skipped');
      select count(*),count(*) filter(where state in ('completed','skipped')),
        count(*) filter(where state in ('failed','requires_review'))
      into total_items,successful_items,failed_items
      from public.integration_sync_items
      where organization_id=target.organization_id and sync_job_id=target.sync_job_id;
      derived_state:=case
        when failed_items=total_items then 'failed'
        when successful_items>0 then 'partially_completed'
        else 'failed' end;
      update public.integration_sync_jobs
      set state=derived_state,last_error='{"code":"attempts_exhausted","retryable":false}'::jsonb
      where id=sync.id;
    end if;
    perform private.redact_integration_sync_payload(sync.id);
  end loop;
  for candidate in
    select * from public.integration_outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp())
      and job.attempt_count<job.max_attempts and job.provider_submission_started_at is null
    order by job.available_at,job.created_at,job.id limit p_batch_size*2
  loop
    exit when returned>=p_batch_size;
    perform private.lock_integration_sync_job(candidate.sync_job_id);
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.sync_job_id is distinct from candidate.sync_job_id
      or target.status not in ('pending','leased') or target.available_at>clock_timestamp()
      or target.attempt_count>=target.max_attempts or target.provider_submission_started_at is not null
      or (target.status='leased' and target.lease_expires_at>clock_timestamp())
    then continue; end if;
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
    select * into preview from public.integration_export_previews where id=sync.source_preview_id for share;
    if preview.id is null or preview.stage<>'ready' or preview.expires_at<=clock_timestamp() then
      update public.integration_outbox_jobs
      set status='cancelled',last_error_code='source_expired',cancelled_at=clock_timestamp(),
        lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs
      set state='cancelled',cancelled_at=clock_timestamp(),
        last_error='{"code":"source_expired","retryable":false}'::jsonb where id=target.sync_job_id;
      update public.integration_sync_items
      set state='cancelled',normalized_error='{"code":"source_expired","retryable":false}'::jsonb,
        retry_eligible=false
      where sync_job_id=target.sync_job_id and state not in ('completed','skipped');
      perform private.redact_integration_sync_payload(sync.id);
      continue;
    end if;
    update public.integration_outbox_jobs
    set status='leased',attempt_count=attempt_count+1,lease_owner=p_lease_owner,
      lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null
    where id=target.id returning * into target;
    update public.integration_sync_items
    set state='processing',attempts=attempts+1
    where organization_id=target.organization_id and sync_job_id=target.sync_job_id
      and item_key=any(target.item_keys) and state='pending';
    update public.integration_sync_jobs set state='processing' where id=sync.id;
    result:=(target.id,target.sync_job_id,target.organization_id,sync.connection_id,sync.provider_key,
      sync.created_by_user_id,target.lease_token,target.lease_generation,target.lease_expires_at,
      target.provider_idempotency_key,target.attempt_number,target.item_keys,
      jsonb_build_object('destination',sync.destination_snapshot,'approvedFields',sync.approved_fields,
        'roster',jsonb_set(preview.roster_snapshot,'{athletes}',coalesce((
          select jsonb_agg(athlete order by athlete->>'registrationId')
          from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete
          where 'athlete:'||(athlete->>'registrationId')=any(target.item_keys)
        ),'[]'::jsonb)),
        'previewId',sync.provider_preview_id,'confirmationToken',preview.provider_confirmation_token));
    returned:=returned+1;
    return next result;
  end loop;
end $$;

alter function public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb)
  rename to complete_integration_outbox_job_legacy_080;

create function public.complete_integration_outbox_job(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_external_job_id text,p_result jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare sync_id uuid;outcome text;durable_state text;eligible boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select sync_job_id into sync_id from public.integration_outbox_jobs where id=p_job_id;
  if sync_id is null then return 'not_found'; end if;
  perform private.lock_integration_sync_job(sync_id);
  outcome:=public.complete_integration_outbox_job_legacy_080(
    p_job_id,p_lease_token,p_lease_generation,p_external_job_id,p_result
  );
  if outcome in ('completed','replayed') then
    select state into durable_state from public.integration_sync_jobs where id=sync_id;
    select exists(
      select 1 from public.integration_sync_items
      where sync_job_id=sync_id and state in ('failed','requires_review') and retry_eligible
    ) into eligible;
    if durable_state='completed'
      or (durable_state in ('failed','partially_completed') and not eligible)
    then perform private.redact_integration_sync_payload(sync_id); end if;
  end if;
  return outcome;
end $$;

alter function public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)
  rename to fail_integration_outbox_job_legacy_080;

create function public.fail_integration_outbox_job(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_error_code text,p_retryable boolean
) returns text language plpgsql security definer set search_path='' as $$
declare sync_id uuid;outcome text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select sync_job_id into sync_id from public.integration_outbox_jobs where id=p_job_id;
  if sync_id is null then return 'not_found'; end if;
  perform private.lock_integration_sync_job(sync_id);
  outcome:=public.fail_integration_outbox_job_legacy_080(
    p_job_id,p_lease_token,p_lease_generation,p_error_code,p_retryable
  );
  if outcome in ('dead_lettered','needs_attention') then
    perform private.redact_integration_sync_payload(sync_id);
  end if;
  return outcome;
end $$;

create or replace function public.purge_expired_integration_previews(p_limit integer)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record;preview public.integration_export_previews%rowtype;
  sync public.integration_sync_jobs%rowtype;outbox public.integration_outbox_jobs%rowtype;
  affected integer:=0;active_lease boolean;handed_off boolean;remaining integer;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid purge limit' using errcode='22023';
  end if;
  affected:=private.repair_integration_sensitive_history(p_limit);
  if affected>=p_limit then return affected; end if;
  remaining:=p_limit-affected;
  for candidate in
    select candidate_preview.id,candidate_preview.sync_job_id
    from public.integration_export_previews candidate_preview
    where candidate_preview.expires_at<=clock_timestamp()
      and (
        candidate_preview.stage<>'redacted'
        or candidate_preview.provider_confirmation_token is not null
        or candidate_preview.roster_snapshot<>'{}'::jsonb
        or candidate_preview.preview_snapshot is not null
      )
      and not exists(
        select 1 from public.integration_outbox_jobs active
        where active.sync_job_id=candidate_preview.sync_job_id
          and active.status='leased' and active.lease_expires_at>clock_timestamp()
      )
    order by candidate_preview.expires_at,candidate_preview.id
    limit remaining
  loop
    active_lease:=false;handed_off:=false;
    if candidate.sync_job_id is not null then
      perform private.lock_integration_sync_job(candidate.sync_job_id);
      -- The stable advisory key is held before this complete sorted row-lock set.
      for outbox in
        select * from public.integration_outbox_jobs
        where sync_job_id=candidate.sync_job_id order by id for update
      loop
        active_lease:=active_lease
          or (outbox.status='leased' and outbox.lease_expires_at>clock_timestamp());
        handed_off:=handed_off or (
          outbox.provider_submission_started_at is not null
          and outbox.status in ('pending','leased')
        );
      end loop;
      if active_lease then continue; end if;
      select * into sync from public.integration_sync_jobs
      where id=candidate.sync_job_id for update;
    end if;
    select * into preview from public.integration_export_previews
    where id=candidate.id for update;
    if not found or preview.expires_at>clock_timestamp() then continue; end if;
    if preview.sync_job_id is null then
      delete from public.integration_export_previews where id=preview.id;
      affected:=affected+1;
      continue;
    end if;
    if sync.state in ('pending','processing') then
      if handed_off then
        update public.integration_outbox_jobs
        set status='needs_attention',last_error_code='delivery_uncertain',dead_lettered_at=clock_timestamp(),
          lease_owner=null,lease_token=null,lease_expires_at=null
        where sync_job_id=sync.id and status in ('pending','leased');
        update public.integration_sync_jobs
        set state='needs_attention',attention_required_at=clock_timestamp(),
          last_error='{"code":"delivery_uncertain","retryable":false}'::jsonb
        where id=sync.id;
        update public.integration_sync_items
        set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}'::jsonb,
          retry_eligible=false
        where sync_job_id=sync.id and state not in ('completed','skipped');
      else
        update public.integration_outbox_jobs
        set status='cancelled',last_error_code='source_expired',cancelled_at=clock_timestamp(),
          lease_owner=null,lease_token=null,lease_expires_at=null
        where sync_job_id=sync.id and status in ('pending','leased');
        update public.integration_sync_jobs
        set state='cancelled',cancelled_at=clock_timestamp(),
          last_error='{"code":"source_expired","retryable":false}'::jsonb
        where id=sync.id;
        update public.integration_sync_items
        set state='cancelled',normalized_error='{"code":"source_expired","retryable":false}'::jsonb,
          retry_eligible=false
        where sync_job_id=sync.id and state not in ('completed','skipped');
      end if;
    else
      update public.integration_sync_items set retry_eligible=false where sync_job_id=sync.id;
    end if;
    perform private.redact_integration_sync_payload(sync.id);
    affected:=affected+1;
  end loop;
  return affected;
end $$;

-- Close every obsolete confirmation/retry boundary. Only v4 confirmation and
-- retry are executable by authenticated callers; worker transitions stay
-- service-role-only and legacy wrappers are owner-internal implementation.
revoke all on function public.confirm_roster_export_preview(uuid,text,text,text),
  public.confirm_roster_export_preview_v2(uuid,text,text,text),
  public.confirm_roster_export_preview_v3(uuid,text,text,text),
  public.confirm_roster_export_preview_v4(uuid,text,text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.confirm_roster_export_preview_v4(uuid,text,text,text,text)
to authenticated;

revoke all on function public.retry_integration_sync_job(uuid,uuid,text),
  public.retry_integration_sync_job_v2(uuid,uuid,text),
  public.retry_integration_sync_job_v3(uuid,uuid,text),
  public.retry_integration_sync_job_v4(uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.retry_integration_sync_job_v4(uuid,uuid,text)
to authenticated;

revoke all on function public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb),
  public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean),
  public.complete_integration_outbox_job_legacy_080(uuid,uuid,bigint,text,jsonb),
  public.fail_integration_outbox_job_legacy_080(uuid,uuid,bigint,text,boolean)
from public,anon,authenticated,service_role;
grant execute on function public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb),
  public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)
to service_role;

revoke all on function private.enforce_integration_preview_redaction(),
  private.clear_integration_sync_legacy_payload(),
  private.lock_integration_sync_job(uuid),
  private.redact_integration_sync_payload(uuid),
  private.repair_integration_sensitive_history(integer),
  private.check_integration_outbox_execution(uuid,uuid,bigint,boolean)
from public,anon,authenticated,service_role;
