-- Close stale-handoff claim, cleanup lock order, replay-token, retry projection, and upgrade-retention gaps.

-- Cap historical rows created before the 079 trigger existed.
update public.integration_export_previews
set expires_at=created_at+interval '7 days'
where expires_at>created_at+interval '7 days';

-- Deterministically remove expired sensitive bytes during the upgrade. Locks follow
-- outbox -> sync -> preview, matching claim, authorization, and completion.
do $$
declare candidate record; target public.integration_export_previews%rowtype;
  sync public.integration_sync_jobs%rowtype; outbox public.integration_outbox_jobs%rowtype;
  found_batch boolean; handed_off boolean;
begin
  loop
    found_batch:=false;
    for candidate in
      select id,sync_job_id from public.integration_export_previews
      where expires_at<=clock_timestamp() and stage<>'redacted'
      order by expires_at,id limit 500
    loop
      found_batch:=true;
      handed_off:=false;
      if candidate.sync_job_id is null then
        select * into target from public.integration_export_previews where id=candidate.id for update;
        if target.id is not null and target.sync_job_id is null and target.stage<>'redacted'
          and target.expires_at<=clock_timestamp()
        then delete from public.integration_export_previews where id=target.id; end if;
        continue;
      end if;
      for outbox in
        select * from public.integration_outbox_jobs where sync_job_id=candidate.sync_job_id
        order by id for update
      loop
        handed_off:=handed_off or (
          outbox.provider_submission_started_at is not null and outbox.status in ('pending','leased')
        );
      end loop;
      select * into sync from public.integration_sync_jobs where id=candidate.sync_job_id for update;
      select * into target from public.integration_export_previews where id=candidate.id for update;
      if target.id is null or target.stage='redacted' or target.expires_at>clock_timestamp() then continue; end if;
      if sync.state in ('pending','processing') then
        if handed_off then
          update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',
            dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null
            where sync_job_id=sync.id and status in ('pending','leased');
          update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),
            last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
          update public.integration_sync_items set state='requires_review',
            normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false
            where sync_job_id=sync.id and state not in ('completed','skipped');
        else
          update public.integration_outbox_jobs set status='cancelled',last_error_code='source_expired',
            cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null
            where sync_job_id=sync.id and status in ('pending','leased');
          update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp(),
            last_error='{"code":"source_expired","retryable":false}' where id=sync.id;
          update public.integration_sync_items set state='cancelled',
            normalized_error='{"code":"source_expired","retryable":false}',retry_eligible=false
            where sync_job_id=sync.id and state not in ('completed','skipped');
        end if;
      else
        update public.integration_sync_items set retry_eligible=false where sync_job_id=sync.id;
      end if;
      update public.integration_export_previews set stage='redacted',roster_snapshot='{}',
        preview_snapshot=null,provider_confirmation_token=null,redacted_at=clock_timestamp() where id=target.id;
    end loop;
    exit when not found_batch;
  end loop;
end $$;

create or replace function public.confirm_roster_export_preview_v3(
  p_organization_id uuid,p_provider_preview_id text,p_confirmation_token text,p_idempotency_key text
) returns public.integration_export_confirmation_v3_result language plpgsql security definer set search_path='' as $$
declare prior public.integration_export_confirmation_v2_result; retry_count integer:=0;
  stored_token_digest text;
begin
  prior:=public.confirm_roster_export_preview_v2(p_organization_id,p_provider_preview_id,p_confirmation_token,p_idempotency_key);
  if prior.outcome in ('queued','replayed','completed') then
    select confirmation_token_digest into stored_token_digest from public.integration_sync_jobs
      where organization_id=p_organization_id and id=prior.job_id;
    if stored_token_digest is distinct from encode(extensions.digest(p_confirmation_token,'sha256'),'hex') then
      return ('conflict',null,null,0,0,0,0,0)::public.integration_export_confirmation_v3_result;
    end if;
    select count(*)::integer into retry_count from public.integration_sync_items item
      where item.organization_id=p_organization_id and item.sync_job_id=prior.job_id
        and item.state in ('failed','requires_review') and item.retry_eligible;
  end if;
  return (prior.outcome,prior.job_id,prior.state,prior.item_count,prior.completed_count,prior.skipped_count,
    prior.failed_count,retry_count)::public.integration_export_confirmation_v3_result;
end $$;

create type public.integration_retry_v3_result as (
  outcome text,job_id uuid,state text,retried_item_count integer,
  preserved_completed_item_count integer,preserved_skipped_item_count integer,
  completed_count integer,skipped_count integer,failed_count integer,retry_eligible_count integer
);

create function public.retry_integration_sync_job_v3(
  p_organization_id uuid,p_job_id uuid,p_idempotency_key text
) returns public.integration_retry_v3_result language plpgsql security definer set search_path='' as $$
declare prior public.integration_retry_v2_result; durable_state text;
  completed_count integer:=0; skipped_count integer:=0; failed_count integer:=0; eligible_count integer:=0;
begin
  prior:=public.retry_integration_sync_job_v2(p_organization_id,p_job_id,p_idempotency_key);
  if prior.job_id is not null then
    select state into durable_state from public.integration_sync_jobs
      where organization_id=p_organization_id and id=prior.job_id;
    select count(*) filter(where state='completed'),count(*) filter(where state='skipped'),
      count(*) filter(where state in ('failed','requires_review')),
      count(*) filter(where state in ('failed','requires_review') and retry_eligible)
      into completed_count,skipped_count,failed_count,eligible_count
      from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=prior.job_id;
  end if;
  return (prior.outcome,prior.job_id,coalesce(durable_state,prior.state),prior.retried_item_count,
    prior.preserved_completed_item_count,prior.preserved_skipped_item_count,completed_count,skipped_count,
    failed_count,eligible_count)::public.integration_retry_v3_result;
end $$;

create or replace function public.claim_integration_outbox_jobs(p_lease_owner text,p_batch_size integer,p_lease_seconds integer)
returns setof public.claimed_integration_outbox_job language plpgsql security definer set search_path='' as $$
declare candidate public.integration_outbox_jobs%rowtype; target public.integration_outbox_jobs%rowtype;
  sync public.integration_sync_jobs%rowtype; preview public.integration_export_previews%rowtype;
  result public.claimed_integration_outbox_job; returned integer:=0;
  total_items integer; successful_items integer; failed_items integer; derived_state text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$' or p_batch_size not between 1 and 50 or p_lease_seconds not between 30 and 300 then raise exception 'invalid job claim' using errcode='22023'; end if;
  for candidate in select * from public.integration_outbox_jobs job
    where job.status='leased' and job.lease_expires_at<=clock_timestamp()
      and (job.provider_submission_started_at is not null or job.attempt_count>=job.max_attempts)
    order by job.available_at,job.created_at,job.id limit p_batch_size
  loop
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.status<>'leased' or target.lease_expires_at>clock_timestamp() then continue; end if;
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
    if target.provider_submission_started_at is not null then
      update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',
        dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),
        last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
      update public.integration_sync_items set state='requires_review',
        normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false
        where organization_id=target.organization_id and sync_job_id=target.sync_job_id
          and item_key=any(target.item_keys) and state not in ('completed','skipped');
    else
      update public.integration_outbox_jobs set status='dead_letter',last_error_code='attempts_exhausted',
        dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_items set state='failed',
        normalized_error='{"code":"attempts_exhausted","retryable":false}',retry_eligible=false
        where organization_id=target.organization_id and sync_job_id=target.sync_job_id
          and item_key=any(target.item_keys) and state not in ('completed','skipped');
      select count(*),count(*) filter(where state in ('completed','skipped')),
        count(*) filter(where state in ('failed','requires_review'))
        into total_items,successful_items,failed_items from public.integration_sync_items
        where organization_id=target.organization_id and sync_job_id=target.sync_job_id;
      derived_state:=case
        when failed_items=total_items then 'failed'
        when successful_items>0 and successful_items+failed_items=total_items then 'partially_completed'
        when successful_items>0 then 'partially_completed'
        else 'failed' end;
      update public.integration_sync_jobs set state=derived_state,
        last_error='{"code":"attempts_exhausted","retryable":false}' where id=sync.id;
    end if;
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',
      preview_snapshot=null,provider_confirmation_token=null,redacted_at=clock_timestamp()
      where id=sync.source_preview_id and stage<>'redacted';
  end loop;
  for candidate in select * from public.integration_outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp())
      and job.attempt_count<job.max_attempts and job.provider_submission_started_at is null
    order by job.available_at,job.created_at,job.id limit p_batch_size*2
  loop
    exit when returned>=p_batch_size;
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.status not in ('pending','leased') or target.available_at>clock_timestamp()
      or target.attempt_count>=target.max_attempts or target.provider_submission_started_at is not null
      or (target.status='leased' and target.lease_expires_at>clock_timestamp()) then continue; end if;
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id for update;
    select * into preview from public.integration_export_previews where id=sync.source_preview_id for share;
    if preview.id is null or preview.stage<>'ready' or preview.expires_at<=clock_timestamp() then
      update public.integration_outbox_jobs set status='cancelled',last_error_code='source_expired',
        cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
      update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp(),
        last_error='{"code":"source_expired","retryable":false}' where id=target.sync_job_id;
      update public.integration_sync_items set state='cancelled',
        normalized_error='{"code":"source_expired","retryable":false}',retry_eligible=false
        where sync_job_id=target.sync_job_id and state not in ('completed','skipped');
      update public.integration_export_previews set stage='redacted',roster_snapshot='{}',
        preview_snapshot=null,provider_confirmation_token=null,redacted_at=clock_timestamp()
        where id=sync.source_preview_id and stage<>'redacted';
      continue;
    end if;
    update public.integration_outbox_jobs set status='leased',attempt_count=attempt_count+1,
      lease_owner=p_lease_owner,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null
      where id=target.id returning * into target;
    update public.integration_sync_items set state='processing',attempts=attempts+1
      where organization_id=target.organization_id and sync_job_id=target.sync_job_id
        and item_key=any(target.item_keys) and state='pending';
    update public.integration_sync_jobs set state='processing' where id=sync.id;
    result:=(target.id,target.sync_job_id,target.organization_id,sync.connection_id,sync.provider_key,
      sync.created_by_user_id,target.lease_token,target.lease_generation,target.lease_expires_at,
      target.provider_idempotency_key,target.attempt_number,target.item_keys,
      jsonb_build_object('destination',sync.destination_snapshot,'approvedFields',sync.approved_fields,
        'roster',jsonb_set(preview.roster_snapshot,'{athletes}',coalesce((select jsonb_agg(athlete order by athlete->>'registrationId')
          from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete
          where 'athlete:'||(athlete->>'registrationId')=any(target.item_keys)),'[]'::jsonb)),
        'previewId',sync.provider_preview_id,'confirmationToken',preview.provider_confirmation_token));
    returned:=returned+1;
    return next result;
  end loop;
end $$;

create or replace function public.purge_expired_integration_previews(p_limit integer) returns integer
language plpgsql security definer set search_path='' as $$
declare candidate record; preview public.integration_export_previews%rowtype; sync public.integration_sync_jobs%rowtype;
  outbox public.integration_outbox_jobs%rowtype; affected integer:=0; active_lease boolean; handed_off boolean;
begin
  if auth.role()<>'service_role' or p_limit not between 1 and 500 then raise exception 'forbidden' using errcode='42501'; end if;
  for candidate in select id,sync_job_id from public.integration_export_previews
    where expires_at<=clock_timestamp() and stage<>'redacted' order by expires_at,id limit p_limit
  loop
    active_lease:=false; handed_off:=false;
    if candidate.sync_job_id is not null then
      for outbox in select * from public.integration_outbox_jobs where sync_job_id=candidate.sync_job_id order by id for update loop
        active_lease:=active_lease or (outbox.status='leased' and outbox.lease_expires_at>clock_timestamp());
        handed_off:=handed_off or (outbox.provider_submission_started_at is not null and outbox.status in ('pending','leased'));
      end loop;
      select * into sync from public.integration_sync_jobs where id=candidate.sync_job_id for update;
      if active_lease then continue; end if;
    end if;
    select * into preview from public.integration_export_previews where id=candidate.id for update;
    if not found or preview.stage='redacted' or preview.expires_at>clock_timestamp() then continue; end if;
    if preview.sync_job_id is null then
      delete from public.integration_export_previews where id=preview.id;
      affected:=affected+1;
      continue;
    end if;
    if sync.state in ('pending','processing') then
      if handed_off then
        update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',
          dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null
          where sync_job_id=sync.id and status in ('pending','leased');
        update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),
          last_error='{"code":"delivery_uncertain","retryable":false}' where id=sync.id;
        update public.integration_sync_items set state='requires_review',
          normalized_error='{"code":"delivery_uncertain","retryable":false}',retry_eligible=false
          where sync_job_id=sync.id and state not in ('completed','skipped');
      else
        update public.integration_outbox_jobs set status='cancelled',last_error_code='source_expired',
          cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null
          where sync_job_id=sync.id and status in ('pending','leased');
        update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp(),
          last_error='{"code":"source_expired","retryable":false}' where id=sync.id;
        update public.integration_sync_items set state='cancelled',
          normalized_error='{"code":"source_expired","retryable":false}',retry_eligible=false
          where sync_job_id=sync.id and state not in ('completed','skipped');
      end if;
    else
      update public.integration_sync_items set retry_eligible=false where sync_job_id=sync.id;
    end if;
    update public.integration_export_previews set stage='redacted',roster_snapshot='{}',
      preview_snapshot=null,provider_confirmation_token=null,redacted_at=clock_timestamp() where id=preview.id;
    affected:=affected+1;
  end loop;
  return affected;
end $$;

revoke all on function public.retry_integration_sync_job_v3(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.retry_integration_sync_job_v3(uuid,uuid,text) to authenticated;
