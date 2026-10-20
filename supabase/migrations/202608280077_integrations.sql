-- Durable, tenant-safe team-management synchronization. The provider is an
-- explicitly labeled demo/mock until a separately authenticated live adapter exists.

create table public.integration_connections (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  provider_key text not null,
  display_name text not null,
  state text not null default 'connected',
  mock_data boolean not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  connected_at timestamptz not null default clock_timestamp(),
  disconnected_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint integration_connections_organization_id_id_key unique(organization_id,id),
  constraint integration_connections_provider_check check(provider_key ~ '^[a-z][a-z0-9-]{1,49}$'),
  constraint integration_connections_display_check check(char_length(trim(display_name)) between 1 and 200),
  constraint integration_connections_state_check check(state in ('connected','disconnected','degraded')),
  constraint integration_connections_lifecycle_check check(
    (state='disconnected' and disconnected_at is not null)
    or (state<>'disconnected' and disconnected_at is null)
  )
);
create unique index integration_connections_actor_provider_key
  on public.integration_connections(organization_id,created_by_user_id,provider_key);
create index integration_connections_organization_idx
  on public.integration_connections(organization_id,state,provider_key);
create trigger set_integration_connections_updated_at before update on public.integration_connections
for each row execute function public.set_updated_at();

create table public.integration_export_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  roster_version_id uuid not null,
  roster_version bigint not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  provider_preview_id text not null,
  provider_confirmation_token text not null,
  provider_snapshot_digest text not null,
  payload_digest text not null,
  destination_snapshot jsonb not null,
  approved_fields text[] not null,
  roster_snapshot jsonb not null,
  preview_snapshot jsonb not null,
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
  consumed_at timestamptz,
  sync_job_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint integration_export_previews_organization_id_id_key unique(organization_id,id),
  constraint integration_export_previews_connection_fkey foreign key(organization_id,connection_id)
    references public.integration_connections(organization_id,id) on delete restrict,
  constraint integration_export_previews_roster_fkey foreign key(organization_id,roster_version_id)
    references public.roster_versions(organization_id,id) on delete restrict,
  constraint integration_export_previews_provider_id_check check(provider_preview_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'),
  constraint integration_export_previews_confirmation_check check(provider_confirmation_token ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'),
  constraint integration_export_previews_snapshot_digest_check check(provider_snapshot_digest ~ '^[0-9a-f]{64}$'),
  constraint integration_export_previews_payload_digest_check check(payload_digest ~ '^[0-9a-f]{64}$'),
  constraint integration_export_previews_version_check check(roster_version between 1 and 9007199254740991),
  constraint integration_export_previews_destination_check check(jsonb_typeof(destination_snapshot)='object'),
  constraint integration_export_previews_roster_check check(jsonb_typeof(roster_snapshot)='object'),
  constraint integration_export_previews_preview_check check(jsonb_typeof(preview_snapshot)='object'),
  constraint integration_export_previews_fields_check check(
    cardinality(approved_fields) between 1 and 7
    and approved_fields <@ array['first_name','last_name','email','phone','position','team_name','tryout_number']::text[]
  ),
  constraint integration_export_previews_expiry_check check(expires_at>created_at),
  constraint integration_export_previews_consumption_check check((consumed_at is null)=(sync_job_id is null))
);
create unique index integration_export_previews_provider_key
  on public.integration_export_previews(organization_id,connection_id,provider_preview_id);
create index integration_export_previews_expiry_idx
  on public.integration_export_previews(expires_at,id) where consumed_at is null;

create table public.integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  provider_key text not null,
  operation text not null default 'roster_export',
  business_idempotency_key text not null,
  request_digest text not null,
  roster_version_id uuid not null,
  roster_version bigint not null,
  destination_snapshot jsonb not null,
  approved_fields text[] not null,
  roster_snapshot jsonb not null,
  provider_preview_id text not null,
  provider_confirmation_token text not null,
  state text not null default 'pending',
  external_job_id text,
  mock_data boolean not null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  attention_required_at timestamptz,
  last_error jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint integration_sync_jobs_organization_id_id_key unique(organization_id,id),
  constraint integration_sync_jobs_connection_fkey foreign key(organization_id,connection_id)
    references public.integration_connections(organization_id,id) on delete restrict,
  constraint integration_sync_jobs_roster_fkey foreign key(organization_id,roster_version_id)
    references public.roster_versions(organization_id,id) on delete restrict,
  constraint integration_sync_jobs_operation_check check(operation='roster_export'),
  constraint integration_sync_jobs_business_key_check check(business_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'),
  constraint integration_sync_jobs_digest_check check(request_digest ~ '^[0-9a-f]{64}$'),
  constraint integration_sync_jobs_provider_check check(provider_key ~ '^[a-z][a-z0-9-]{1,49}$'),
  constraint integration_sync_jobs_version_check check(roster_version between 1 and 9007199254740991),
  constraint integration_sync_jobs_state_check check(state in ('pending','processing','completed','partially_completed','failed','needs_attention')),
  constraint integration_sync_jobs_external_id_check check(external_job_id is null or external_job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  constraint integration_sync_jobs_error_check check(last_error is null or (
    jsonb_typeof(last_error)='object' and last_error ? 'code' and last_error ? 'retryable'
  )),
  constraint integration_sync_jobs_terminal_check check(
    (state='completed' and completed_at is not null and attention_required_at is null)
    or (state='needs_attention' and completed_at is null and attention_required_at is not null)
    or (state not in ('completed','needs_attention') and completed_at is null and attention_required_at is null)
  )
);
create unique index integration_sync_jobs_idempotency_key
  on public.integration_sync_jobs(organization_id,connection_id,business_idempotency_key);
create index integration_sync_jobs_roster_idx
  on public.integration_sync_jobs(organization_id,roster_version_id,created_at desc,id);
create index integration_sync_jobs_state_idx
  on public.integration_sync_jobs(organization_id,state,updated_at desc,id);
create trigger set_integration_sync_jobs_updated_at before update on public.integration_sync_jobs
for each row execute function public.set_updated_at();

alter table public.integration_export_previews
  add constraint integration_export_previews_job_fkey foreign key(organization_id,sync_job_id)
  references public.integration_sync_jobs(organization_id,id) on delete restrict;

create table public.integration_sync_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sync_job_id uuid not null,
  item_key text not null,
  entity_type text not null,
  internal_entity_id uuid not null,
  operation text not null,
  state text not null default 'pending',
  attempts integer not null default 0,
  external_ref jsonb,
  normalized_error jsonb,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint integration_sync_items_organization_id_id_key unique(organization_id,id),
  constraint integration_sync_items_job_fkey foreign key(organization_id,sync_job_id)
    references public.integration_sync_jobs(organization_id,id) on delete restrict,
  constraint integration_sync_items_job_item_key unique(organization_id,sync_job_id,item_key),
  constraint integration_sync_items_item_key_check check(item_key ~ '^[a-z][a-z0-9_-]{1,39}:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  constraint integration_sync_items_type_check check(entity_type in ('athlete','team','roster_version')),
  constraint integration_sync_items_operation_check check(operation in ('create','update','skip','requires_review')),
  constraint integration_sync_items_state_check check(state in ('pending','processing','completed','failed','skipped','requires_review')),
  constraint integration_sync_items_attempts_check check(attempts between 0 and 100),
  constraint integration_sync_items_shape_check check(
    (state='pending' and normalized_error is null and completed_at is null)
    or (state='processing' and attempts>0 and normalized_error is null and completed_at is null)
    or (state in ('completed','skipped') and normalized_error is null and completed_at is not null)
    or (state in ('failed','requires_review') and normalized_error is not null and completed_at is null)
  ),
  constraint integration_sync_items_external_ref_check check(
    external_ref is null or (jsonb_typeof(external_ref)='object' and external_ref ? 'externalId' and external_ref ? 'entityType')
  ),
  constraint integration_sync_items_error_check check(
    normalized_error is null or (jsonb_typeof(normalized_error)='object' and normalized_error ? 'code' and normalized_error ? 'retryable')
  )
);
create index integration_sync_items_job_state_idx
  on public.integration_sync_items(organization_id,sync_job_id,state,item_key);
create trigger set_integration_sync_items_updated_at before update on public.integration_sync_items
for each row execute function public.set_updated_at();

create table public.external_entity_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  provider_key text not null,
  entity_type text not null,
  internal_entity_id uuid not null,
  external_id text not null,
  external_ref jsonb not null,
  first_sync_job_id uuid not null,
  last_sync_job_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_entity_mappings_organization_id_id_key unique(organization_id,id),
  constraint external_entity_mappings_connection_fkey foreign key(organization_id,connection_id)
    references public.integration_connections(organization_id,id) on delete restrict,
  constraint external_entity_mappings_first_job_fkey foreign key(organization_id,first_sync_job_id)
    references public.integration_sync_jobs(organization_id,id) on delete restrict,
  constraint external_entity_mappings_last_job_fkey foreign key(organization_id,last_sync_job_id)
    references public.integration_sync_jobs(organization_id,id) on delete restrict,
  constraint external_entity_mappings_provider_check check(provider_key ~ '^[a-z][a-z0-9-]{1,49}$'),
  constraint external_entity_mappings_type_check check(entity_type in ('athlete','team','roster_version')),
  constraint external_entity_mappings_external_id_check check(external_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  constraint external_entity_mappings_ref_check check(jsonb_typeof(external_ref)='object')
);
create unique index external_entity_mappings_internal_key
  on public.external_entity_mappings(organization_id,connection_id,entity_type,internal_entity_id);
create unique index external_entity_mappings_external_key
  on public.external_entity_mappings(organization_id,connection_id,entity_type,external_id);
create trigger set_external_entity_mappings_updated_at before update on public.external_entity_mappings
for each row execute function public.set_updated_at();

create table public.integration_outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sync_job_id uuid not null,
  attempt_number integer not null,
  retry_idempotency_key text not null,
  provider_idempotency_key text not null,
  item_keys text[] not null,
  status text not null default 'pending',
  available_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  lease_owner text,
  lease_token uuid,
  lease_generation bigint not null default 0,
  lease_expires_at timestamptz,
  provider_submission_started_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint integration_outbox_jobs_organization_id_id_key unique(organization_id,id),
  constraint integration_outbox_jobs_job_fkey foreign key(organization_id,sync_job_id)
    references public.integration_sync_jobs(organization_id,id) on delete restrict,
  constraint integration_outbox_jobs_attempt_key unique(organization_id,sync_job_id,attempt_number),
  constraint integration_outbox_jobs_retry_key unique(organization_id,retry_idempotency_key),
  constraint integration_outbox_jobs_provider_key unique(provider_idempotency_key),
  constraint integration_outbox_jobs_attempt_check check(attempt_number between 1 and 100),
  constraint integration_outbox_jobs_retry_idempotency_check check(retry_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'),
  constraint integration_outbox_jobs_provider_idempotency_check check(provider_idempotency_key ~ '^integration:[0-9a-f-]{36}:[0-9]{1,3}$'),
  constraint integration_outbox_jobs_items_check check(cardinality(item_keys) between 1 and 5100),
  constraint integration_outbox_jobs_status_check check(status in ('pending','leased','completed','dead_letter','needs_attention')),
  constraint integration_outbox_jobs_attempts_check check(attempt_count between 0 and max_attempts and max_attempts between 1 and 20),
  constraint integration_outbox_jobs_lease_check check(
    (status='leased' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
    or (status<>'leased' and lease_owner is null and lease_token is null and lease_expires_at is null)
  ),
  constraint integration_outbox_jobs_terminal_check check(
    (status='completed' and completed_at is not null and dead_lettered_at is null)
    or (status in ('dead_letter','needs_attention') and completed_at is null and dead_lettered_at is not null)
    or (status in ('pending','leased') and completed_at is null and dead_lettered_at is null)
  ),
  constraint integration_outbox_jobs_error_check check(last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{2,63}$')
);
create index integration_outbox_jobs_claim_idx
  on public.integration_outbox_jobs(available_at,created_at,id)
  where status in ('pending','leased');
create trigger set_integration_outbox_jobs_updated_at before update on public.integration_outbox_jobs
for each row execute function public.set_updated_at();

alter table public.integration_connections enable row level security;
alter table public.integration_export_previews enable row level security;
alter table public.integration_sync_jobs enable row level security;
alter table public.integration_sync_items enable row level security;
alter table public.external_entity_mappings enable row level security;
alter table public.integration_outbox_jobs enable row level security;

create policy integration_connections_read on public.integration_connections for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy integration_export_previews_read on public.integration_export_previews for select to authenticated
using(created_by_user_id=auth.uid() and public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy integration_sync_jobs_read on public.integration_sync_jobs for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy integration_sync_items_read on public.integration_sync_items for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy external_entity_mappings_read on public.external_entity_mappings for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));

create function private.can_manage_integrations(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and public.is_active_organization_member(p_organization_id,array['owner','administrator']);
$$;

create function public.save_integration_connection(
  p_organization_id uuid,p_provider_key text,p_connection_id uuid,p_display_name text,p_mock_data boolean
) returns text language plpgsql security definer set search_path='' as $$
declare existing public.integration_connections%rowtype;
begin
  if not private.can_manage_integrations(p_organization_id) then return 'forbidden'; end if;
  if p_provider_key !~ '^[a-z][a-z0-9-]{1,49}$' or char_length(trim(p_display_name)) not between 1 and 200
    or p_connection_id is null then return 'invalid_input'; end if;
  if p_provider_key='the-squad' and (not p_mock_data or p_display_name !~* 'demo|mock') then
    return 'invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||auth.uid()::text||':'||p_provider_key,0));
  select * into existing from public.integration_connections
    where organization_id=p_organization_id and created_by_user_id=auth.uid() and provider_key=p_provider_key for update;
  if found and existing.id<>p_connection_id then return 'conflict'; end if;
  insert into public.integration_connections(id,organization_id,provider_key,display_name,mock_data,created_by_user_id,last_verified_at)
  values(p_connection_id,p_organization_id,p_provider_key,trim(p_display_name),p_mock_data,auth.uid(),clock_timestamp())
  on conflict(id) do update set state='connected',display_name=excluded.display_name,mock_data=excluded.mock_data,
    disconnected_at=null,last_verified_at=clock_timestamp()
  where integration_connections.organization_id=excluded.organization_id
    and integration_connections.created_by_user_id=auth.uid()
    and integration_connections.provider_key=excluded.provider_key;
  if not found then return 'conflict'; end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'integration.connected','integration_connection',p_connection_id);
  return case when existing.id is null then 'connected' else 'replayed' end;
end $$;

create function public.load_roster_export_context(
  p_organization_id uuid,p_connection_id uuid,p_roster_version_id uuid
) returns table(outcome text,provider_key text,mock_data boolean,roster jsonb)
language plpgsql security definer set search_path='' as $$
declare connection public.integration_connections%rowtype; version public.roster_versions%rowtype; snapshot jsonb;
begin
  if not private.can_manage_integrations(p_organization_id) then
    return query select 'forbidden',null::text,null::boolean,null::jsonb; return;
  end if;
  select * into connection from public.integration_connections
    where organization_id=p_organization_id and id=p_connection_id and created_by_user_id=auth.uid() and state='connected';
  if not found then return query select 'not_found',null::text,null::boolean,null::jsonb; return; end if;
  select * into version from public.roster_versions
    where organization_id=p_organization_id and id=p_roster_version_id;
  if not found then return query select 'not_found',null::text,null::boolean,null::jsonb; return; end if;
  if version.state<>'finalized' then return query select 'invalid_state',null::text,null::boolean,null::jsonb; return; end if;
  select jsonb_build_object(
    'organizationId',version.organization_id,'tryoutId',version.tryout_id,'divisionId',version.division_id,
    'rosterVersionId',version.id,'version',version.version,'state','finalized','finalizedAt',version.finalized_at,
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',team.id,'name',team.name) order by team.sort_order,team.id)
      from public.tryout_teams team where team.organization_id=version.organization_id and team.tryout_id=version.tryout_id
        and team.division_id=version.division_id),'[]'::jsonb),
    'athletes',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'registrationId',assignment.registration_id,'firstName',athlete.given_name,'lastName',athlete.family_name,
      'email',guardian.email::text,'position',position.name,'tryoutNumber',number_assignment.number,'teamId',assignment.team_id
    )) order by assignment.registration_id)
      from public.roster_assignments assignment
      join public.tryout_registrations registration on registration.organization_id=assignment.organization_id
        and registration.id=assignment.registration_id
      join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
      left join public.tryout_positions position on position.organization_id=registration.organization_id
        and position.tryout_id=registration.tryout_id and position.id=registration.position_id
      left join lateral(select guardian.email from public.athlete_guardians link
        join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
        where link.organization_id=registration.organization_id and link.athlete_id=registration.athlete_id
        order by link.is_primary_contact desc,guardian.id limit 1) guardian on true
      left join lateral(select candidate.number from public.tryout_numbers candidate
        where candidate.organization_id=registration.organization_id and candidate.tryout_id=registration.tryout_id
          and candidate.registration_id=registration.id and candidate.released_at is null
        order by candidate.assigned_at desc,candidate.id limit 1) number_assignment on true
      where assignment.organization_id=version.organization_id and assignment.roster_version_id=version.id),'[]'::jsonb)
  ) into snapshot;
  return query select 'ok',connection.provider_key,connection.mock_data,snapshot;
end $$;

create function public.save_roster_export_preview(
  p_organization_id uuid,p_connection_id uuid,p_roster_version_id uuid,p_destination jsonb,p_approved_fields text[],
  p_provider_preview_id text,p_confirmation_token text,p_snapshot_digest text,p_preview jsonb,p_payload_digest text
) returns text language plpgsql security definer set search_path='' as $$
declare context record; existing public.integration_export_previews%rowtype;
begin
  select * into context from public.load_roster_export_context(p_organization_id,p_connection_id,p_roster_version_id);
  if context.outcome<>'ok' then return context.outcome; end if;
  if p_destination is null or jsonb_typeof(p_destination)<>'object'
    or p_preview is null or jsonb_typeof(p_preview)<>'object'
    or p_provider_preview_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_confirmation_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_snapshot_digest !~ '^[0-9a-f]{64}$' or p_payload_digest !~ '^[0-9a-f]{64}$'
    or cardinality(p_approved_fields) not between 1 and 7
    or p_approved_fields <@ array['first_name','last_name','email','phone','position','team_name','tryout_number']::text[] is not true
    or (select count(*) from unnest(p_approved_fields) field)<>(select count(distinct field) from unnest(p_approved_fields) field)
    or p_preview->>'previewId' is distinct from p_provider_preview_id
    or p_preview->>'confirmationToken' is distinct from p_confirmation_token
    or p_preview->>'snapshotDigest' is distinct from p_snapshot_digest
  then return 'invalid_input'; end if;
  select * into existing from public.integration_export_previews
    where organization_id=p_organization_id and connection_id=p_connection_id and provider_preview_id=p_provider_preview_id;
  if found then return case when existing.payload_digest=p_payload_digest and existing.created_by_user_id=auth.uid()
    then 'replayed' else 'conflict' end; end if;
  insert into public.integration_export_previews(organization_id,connection_id,roster_version_id,roster_version,created_by_user_id,
    provider_preview_id,provider_confirmation_token,provider_snapshot_digest,payload_digest,destination_snapshot,approved_fields,roster_snapshot,preview_snapshot)
  values(p_organization_id,p_connection_id,p_roster_version_id,(context.roster->>'version')::bigint,auth.uid(),
    p_provider_preview_id,p_confirmation_token,p_snapshot_digest,p_payload_digest,p_destination,p_approved_fields,context.roster,p_preview);
  return 'created';
end $$;

create type public.integration_export_confirmation_result as (outcome text,job_id uuid);

create function public.confirm_roster_export_preview(
  p_organization_id uuid,p_provider_preview_id text,p_confirmation_token text,p_idempotency_key text
) returns public.integration_export_confirmation_result
language plpgsql security definer set search_path='' as $$
declare preview public.integration_export_previews%rowtype; existing public.integration_sync_jobs%rowtype;
  connection public.integration_connections%rowtype; version public.roster_versions%rowtype; created_job uuid:=gen_random_uuid();
  keys text[];
begin
  if not private.can_manage_integrations(p_organization_id) then return ('forbidden'::text,null::uuid); end if;
  if p_provider_preview_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_confirmation_token !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$' then return ('invalid_input'::text,null::uuid); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_provider_preview_id,0));
  select * into preview from public.integration_export_previews
    where organization_id=p_organization_id and provider_preview_id=p_provider_preview_id for update;
  if not found or preview.created_by_user_id<>auth.uid() then return ('not_found'::text,null::uuid); end if;
  select * into existing from public.integration_sync_jobs where organization_id=p_organization_id
    and connection_id=preview.connection_id and business_idempotency_key=p_idempotency_key;
  if found then return case when existing.request_digest=preview.payload_digest then ('replayed'::text,existing.id)
    else ('conflict'::text,null::uuid) end; end if;
  if preview.consumed_at is not null then return ('already_consumed'::text,null::uuid); end if;
  if preview.expires_at<=clock_timestamp() then return ('stale'::text,null::uuid); end if;
  if preview.provider_confirmation_token<>p_confirmation_token then return ('conflict'::text,null::uuid); end if;
  select * into connection from public.integration_connections where organization_id=p_organization_id
    and id=preview.connection_id and created_by_user_id=auth.uid() and state='connected' for share;
  if not found then return ('stale'::text,null::uuid); end if;
  select roster.* into version from public.roster_versions roster where roster.organization_id=p_organization_id
    and roster.id=preview.roster_version_id and roster.state='finalized' and roster.version=preview.roster_version for share;
  if not found then return ('stale'::text,null::uuid); end if;
  select array_agg('athlete:'||(athlete->>'registrationId') order by athlete->>'registrationId') into keys
    from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete;
  keys:=coalesce(keys,array[]::text[]);
  insert into public.integration_sync_jobs(id,organization_id,connection_id,provider_key,business_idempotency_key,request_digest,
    roster_version_id,roster_version,destination_snapshot,approved_fields,roster_snapshot,provider_preview_id,
    provider_confirmation_token,state,mock_data,created_by_user_id,completed_at)
  values(created_job,p_organization_id,preview.connection_id,connection.provider_key,p_idempotency_key,preview.payload_digest,
    preview.roster_version_id,preview.roster_version,preview.destination_snapshot,preview.approved_fields,preview.roster_snapshot,
    preview.provider_preview_id,preview.provider_confirmation_token,
    case when cardinality(keys)=0 then 'completed' else 'pending' end,
    connection.mock_data,auth.uid(),case when cardinality(keys)=0 then clock_timestamp() else null end);
  insert into public.integration_sync_items(organization_id,sync_job_id,item_key,entity_type,internal_entity_id,operation)
  select p_organization_id,created_job,'athlete:'||(athlete->>'registrationId'),'athlete',(athlete->>'registrationId')::uuid,
    coalesce((select item->>'operation' from jsonb_array_elements(preview.preview_snapshot->'items') item
      where item->>'itemKey'='athlete:'||(athlete->>'registrationId')),'requires_review')
  from jsonb_array_elements(preview.roster_snapshot->'athletes') athlete;
  if cardinality(keys)>0 then
    insert into public.integration_outbox_jobs(organization_id,sync_job_id,attempt_number,retry_idempotency_key,provider_idempotency_key,item_keys)
    values(p_organization_id,created_job,1,p_idempotency_key,'integration:'||created_job::text||':1',keys);
  end if;
  update public.integration_export_previews set consumed_at=clock_timestamp(),sync_job_id=created_job where id=preview.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'integration.roster_export_confirmed','integration_sync_job',created_job);
  return ('queued'::text,created_job);
end $$;

create type public.integration_retry_result as (
  outcome text,job_id uuid,retried_item_count integer,preserved_completed_item_count integer
);

create function public.retry_integration_sync_job(p_organization_id uuid,p_job_id uuid,p_idempotency_key text)
returns public.integration_retry_result language plpgsql security definer set search_path='' as $$
declare target public.integration_sync_jobs%rowtype; prior public.integration_outbox_jobs%rowtype;
  keys text[]; retry_count integer; completed_count integer; next_attempt integer;
begin
  if not private.can_manage_integrations(p_organization_id) then return ('forbidden'::text,null::uuid,0::integer,0::integer); end if;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$' then return ('invalid_input'::text,null::uuid,0::integer,0::integer); end if;
  select * into prior from public.integration_outbox_jobs
    where organization_id=p_organization_id and retry_idempotency_key=p_idempotency_key;
  if found then
    select count(*) filter(where state in ('completed','skipped')) into completed_count
      from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=prior.sync_job_id;
    return ('replayed'::text,prior.sync_job_id,cardinality(prior.item_keys),completed_count);
  end if;
  select * into target from public.integration_sync_jobs where organization_id=p_organization_id and id=p_job_id for update;
  if not found then return ('not_found'::text,null::uuid,0::integer,0::integer); end if;
  if target.created_by_user_id<>auth.uid() then return ('forbidden'::text,null::uuid,0::integer,0::integer); end if;
  select array_agg(item_key order by item_key),count(*) into keys,retry_count
    from public.integration_sync_items where organization_id=p_organization_id and sync_job_id=p_job_id
      and state in ('failed','requires_review');
  select count(*) into completed_count from public.integration_sync_items where organization_id=p_organization_id
    and sync_job_id=p_job_id and state in ('completed','skipped');
  if coalesce(retry_count,0)=0 then return ('nothing_to_retry'::text,p_job_id,0::integer,completed_count); end if;
  select coalesce(max(attempt_number),0)+1 into next_attempt from public.integration_outbox_jobs
    where organization_id=p_organization_id and sync_job_id=p_job_id;
  if next_attempt>100 then return ('conflict'::text,null::uuid,0::integer,0::integer); end if;
  update public.integration_sync_items set state='pending',normalized_error=null,completed_at=null
    where organization_id=p_organization_id and sync_job_id=p_job_id and item_key=any(keys)
      and state in ('failed','requires_review');
  update public.integration_sync_jobs set state='pending',completed_at=null,attention_required_at=null,last_error=null
    where organization_id=p_organization_id and id=p_job_id;
  insert into public.integration_outbox_jobs(organization_id,sync_job_id,attempt_number,retry_idempotency_key,provider_idempotency_key,item_keys)
    values(p_organization_id,p_job_id,next_attempt,p_idempotency_key,'integration:'||p_job_id::text||':'||next_attempt,keys);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'integration.sync_retried','integration_sync_job',p_job_id);
  return ('queued'::text,p_job_id,retry_count,completed_count);
end $$;

create type public.claimed_integration_outbox_job as (
  outbox_job_id uuid,sync_job_id uuid,organization_id uuid,connection_id uuid,provider_key text,actor_user_id uuid,
  lease_token uuid,lease_generation bigint,lease_expires_at timestamptz,provider_idempotency_key text,
  attempt_number integer,item_keys text[],confirmed_request jsonb
);

create function public.claim_integration_outbox_jobs(p_lease_owner text,p_batch_size integer,p_lease_seconds integer)
returns setof public.claimed_integration_outbox_job language plpgsql security definer set search_path='' as $$
declare candidate public.integration_outbox_jobs%rowtype; target public.integration_outbox_jobs%rowtype;
  sync public.integration_sync_jobs%rowtype; result public.claimed_integration_outbox_job; handled integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$' or p_batch_size not between 1 and 50
    or p_lease_seconds not between 30 and 300 then raise exception 'invalid job claim' using errcode='22023'; end if;
  for candidate in select * from public.integration_outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp())
    order by job.available_at,job.created_at,job.id limit p_batch_size*2
  loop
    select * into target from public.integration_outbox_jobs where id=candidate.id for update skip locked;
    if not found or target.status not in ('pending','leased') or target.available_at>clock_timestamp()
      or (target.status='leased' and target.lease_expires_at>clock_timestamp()) then continue; end if;
    handled:=handled+1;
    if target.status='leased' and target.provider_submission_started_at is not null then
      update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',
        lease_owner=null,lease_token=null,lease_expires_at=null,dead_lettered_at=clock_timestamp() where id=target.id;
      update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),
        last_error='{"code":"delivery_uncertain","retryable":false}'::jsonb where id=target.sync_job_id;
      update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}'::jsonb
        where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys)
          and state not in ('completed','skipped');
      if handled>=p_batch_size then return; end if; continue;
    end if;
    if target.attempt_count>=target.max_attempts then
      update public.integration_outbox_jobs set status='dead_letter',last_error_code='attempts_exhausted',
        lease_owner=null,lease_token=null,lease_expires_at=null,dead_lettered_at=clock_timestamp() where id=target.id;
      update public.integration_sync_items set state='failed',normalized_error='{"code":"provider_temporary","retryable":true}'::jsonb
        where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys)
          and state not in ('completed','skipped');
      update public.integration_sync_jobs set state='failed',last_error='{"code":"provider_temporary","retryable":true}'::jsonb
        where id=target.sync_job_id;
      if handled>=p_batch_size then return; end if; continue;
    end if;
    update public.integration_outbox_jobs set status='leased',attempt_count=attempt_count+1,lease_owner=p_lease_owner,
      lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null
      where id=target.id returning * into target;
    update public.integration_sync_items set state='processing',attempts=attempts+1
      where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys)
        and state='pending';
    select * into sync from public.integration_sync_jobs where id=target.sync_job_id;
    update public.integration_sync_jobs set state='processing' where id=sync.id;
    result:=(target.id,target.sync_job_id,target.organization_id,sync.connection_id,sync.provider_key,sync.created_by_user_id,
      target.lease_token,target.lease_generation,target.lease_expires_at,target.provider_idempotency_key,target.attempt_number,target.item_keys,
      jsonb_build_object('destination',sync.destination_snapshot,'approvedFields',sync.approved_fields,
        'roster',jsonb_set(sync.roster_snapshot,'{athletes}',coalesce((select jsonb_agg(athlete order by athlete->>'registrationId')
          from jsonb_array_elements(sync.roster_snapshot->'athletes') athlete
          where 'athlete:'||(athlete->>'registrationId')=any(target.item_keys)),'[]'::jsonb)),
        'previewId',sync.provider_preview_id,'confirmationToken',sync.provider_confirmation_token));
    return next result;
    if handled>=p_batch_size then return; end if;
  end loop;
end $$;

create function public.authorize_integration_outbox_submission(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint)
returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select * into target from public.integration_outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token
    or target.lease_generation<>p_lease_generation or target.lease_expires_at<=clock_timestamp()
    then return 'lease_conflict'; end if;
  update public.integration_outbox_jobs set provider_submission_started_at=coalesce(provider_submission_started_at,clock_timestamp())
    where id=p_job_id;
  return 'authorized';
end $$;

create function public.complete_integration_outbox_job(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_external_job_id text,p_result jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare outbox public.integration_outbox_jobs%rowtype; sync public.integration_sync_jobs%rowtype; item jsonb;
  stored public.integration_sync_items%rowtype; reference jsonb; mapped_external_id text; completed_count integer;
  failed_count integer; total_count integer; derived_state text; conflict_error jsonb:='{"code":"conflict","retryable":false}'::jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_external_job_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' or jsonb_typeof(p_result)<>'object'
    or p_result->>'externalJobId' is distinct from p_external_job_id or jsonb_typeof(p_result->'items')<>'array'
    or jsonb_array_length(p_result->'items')>5100 then return 'invalid_input'; end if;
  select * into outbox from public.integration_outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if outbox.status='completed' then
    select * into sync from public.integration_sync_jobs where id=outbox.sync_job_id;
    return case when sync.external_job_id=p_external_job_id then 'replayed' else 'terminal_conflict' end;
  end if;
  if outbox.status<>'leased' or outbox.lease_token is distinct from p_lease_token
    or outbox.lease_generation<>p_lease_generation or outbox.lease_expires_at<=clock_timestamp()
    or outbox.provider_submission_started_at is null then return 'lease_conflict'; end if;
  select * into sync from public.integration_sync_jobs where id=outbox.sync_job_id for update;
  for item in select value from jsonb_array_elements(p_result->'items')
  loop
    if item->>'itemKey' is null or not (item->>'itemKey'=any(outbox.item_keys))
      or item->>'state' not in ('completed','failed','skipped','requires_review') then return 'invalid_input'; end if;
    select * into stored from public.integration_sync_items where organization_id=outbox.organization_id
      and sync_job_id=outbox.sync_job_id and item_key=item->>'itemKey' for update;
    if not found then return 'invalid_input'; end if;
    if stored.state in ('completed','skipped') then continue; end if;
    reference:=item->'externalRef';
    if item->>'state'='completed' then
      if reference is null or jsonb_typeof(reference)<>'object' or reference->>'entityType'<>stored.entity_type
        or reference->>'providerKey'<>sync.provider_key or coalesce((reference->>'mockData')::boolean,not sync.mock_data)<>sync.mock_data
        then return 'invalid_input'; end if;
      mapped_external_id:=reference->>'externalId';
      if mapped_external_id is null or mapped_external_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then return 'invalid_input'; end if;
      if exists(select 1 from public.external_entity_mappings mapping where mapping.organization_id=outbox.organization_id
        and mapping.connection_id=sync.connection_id and mapping.entity_type=stored.entity_type
        and mapping.internal_entity_id=stored.internal_entity_id and mapping.external_id<>mapped_external_id)
        or exists(select 1 from public.external_entity_mappings mapping where mapping.organization_id=outbox.organization_id
        and mapping.connection_id=sync.connection_id and mapping.entity_type=stored.entity_type
        and mapping.external_id=mapped_external_id and mapping.internal_entity_id<>stored.internal_entity_id)
      then
        update public.integration_sync_items set state='requires_review',external_ref=null,normalized_error=conflict_error,completed_at=null
          where id=stored.id;
      else
        insert into public.external_entity_mappings(organization_id,connection_id,provider_key,entity_type,internal_entity_id,
          external_id,external_ref,first_sync_job_id,last_sync_job_id)
        values(outbox.organization_id,sync.connection_id,sync.provider_key,stored.entity_type,stored.internal_entity_id,
          mapped_external_id,reference,sync.id,sync.id)
        on conflict(organization_id,connection_id,entity_type,internal_entity_id)
        do update set external_ref=excluded.external_ref,last_sync_job_id=excluded.last_sync_job_id
          where external_entity_mappings.external_id=excluded.external_id;
        update public.integration_sync_items set state='completed',external_ref=reference,normalized_error=null,
          completed_at=clock_timestamp() where id=stored.id;
      end if;
    elsif item->>'state'='skipped' then
      update public.integration_sync_items set state='skipped',external_ref=reference,normalized_error=null,
        completed_at=clock_timestamp() where id=stored.id;
    else
      if item->'error' is null or jsonb_typeof(item->'error')<>'object' or not (item->'error' ? 'code')
        or not (item->'error' ? 'retryable') then return 'invalid_input'; end if;
      update public.integration_sync_items set state=item->>'state',external_ref=null,
        normalized_error=jsonb_build_object('code',item->'error'->>'code','retryable',(item->'error'->>'retryable')::boolean)
          || case when item->'error' ? 'retryAfterSeconds' then jsonb_build_object('retryAfterSeconds',(item->'error'->>'retryAfterSeconds')::integer) else '{}'::jsonb end,
        completed_at=null where id=stored.id;
    end if;
  end loop;
  select count(*),count(*) filter(where state in ('completed','skipped')),
    count(*) filter(where state in ('failed','requires_review'))
    into total_count,completed_count,failed_count from public.integration_sync_items
    where organization_id=outbox.organization_id and sync_job_id=outbox.sync_job_id;
  if completed_count=total_count then derived_state:='completed';
  elsif completed_count>0 and completed_count+failed_count=total_count then derived_state:='partially_completed';
  elsif failed_count=total_count then derived_state:='failed';
  else return 'invalid_result'; end if;
  update public.integration_sync_jobs set state=derived_state,external_job_id=p_external_job_id,
    completed_at=case when derived_state='completed' then clock_timestamp() else null end,
    attention_required_at=null,last_error=case when failed_count>0 then '{"code":"item_failures","retryable":false}'::jsonb else null end
    where id=sync.id;
  update public.integration_outbox_jobs set status='completed',completed_at=clock_timestamp(),dead_lettered_at=null,
    last_error_code=null,lease_owner=null,lease_token=null,lease_expires_at=null where id=outbox.id;
  return 'completed';
end $$;

create function public.fail_integration_outbox_job(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_error_code text,p_retryable boolean
) returns text language plpgsql security definer set search_path='' as $$
declare target public.integration_outbox_jobs%rowtype; terminal boolean; error jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_error_code !~ '^[a-z][a-z0-9_]{2,63}$' then return 'invalid_input'; end if;
  select * into target from public.integration_outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation
    or target.status<>'leased' or target.lease_expires_at<=clock_timestamp() then return 'lease_conflict'; end if;
  error:=jsonb_build_object('code',p_error_code,'retryable',p_retryable);
  if target.provider_submission_started_at is not null then
    update public.integration_outbox_jobs set status='needs_attention',last_error_code='delivery_uncertain',
      dead_lettered_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
    update public.integration_sync_items set state='requires_review',normalized_error='{"code":"delivery_uncertain","retryable":false}'::jsonb
      where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys)
        and state not in ('completed','skipped');
    update public.integration_sync_jobs set state='needs_attention',attention_required_at=clock_timestamp(),
      last_error='{"code":"delivery_uncertain","retryable":false}'::jsonb where id=target.sync_job_id;
    return 'needs_attention';
  end if;
  terminal:=not p_retryable or target.attempt_count>=target.max_attempts;
  if terminal then
    update public.integration_outbox_jobs set status='dead_letter',last_error_code=p_error_code,dead_lettered_at=clock_timestamp(),
      lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
    update public.integration_sync_items set state='failed',normalized_error=error
      where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys)
        and state not in ('completed','skipped');
    update public.integration_sync_jobs set state='failed',last_error=error where id=target.sync_job_id;
    return 'dead_lettered';
  end if;
  update public.integration_sync_items set state='pending',normalized_error=null
    where organization_id=target.organization_id and sync_job_id=target.sync_job_id and item_key=any(target.item_keys)
      and state='processing';
  update public.integration_sync_jobs set state='pending',last_error=error where id=target.sync_job_id;
  update public.integration_outbox_jobs set status='pending',last_error_code=p_error_code,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,
      30*(2::numeric^greatest(0,target.attempt_count-1))+((hashtextextended(target.id::text||':'||target.lease_generation::text,0)&1023)%11)
    )::integer),lease_owner=null,lease_token=null,lease_expires_at=null where id=target.id;
  return 'retry_scheduled';
end $$;

revoke all on table public.integration_connections,public.integration_export_previews,public.integration_sync_jobs,
  public.integration_sync_items,public.external_entity_mappings,public.integration_outbox_jobs from public,anon,authenticated,service_role;
grant select on table public.integration_connections,public.integration_export_previews,public.integration_sync_jobs,
  public.integration_sync_items,public.external_entity_mappings to authenticated;

revoke all on function private.can_manage_integrations(uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_integration_connection(uuid,text,uuid,text,boolean),
  public.load_roster_export_context(uuid,uuid,uuid),
  public.save_roster_export_preview(uuid,uuid,uuid,jsonb,text[],text,text,text,jsonb,text),
  public.confirm_roster_export_preview(uuid,text,text,text),
  public.retry_integration_sync_job(uuid,uuid,text),
  public.claim_integration_outbox_jobs(text,integer,integer),
  public.authorize_integration_outbox_submission(uuid,uuid,bigint),
  public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb),
  public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)
from public,anon,authenticated,service_role;

grant execute on function public.save_integration_connection(uuid,text,uuid,text,boolean),
  public.load_roster_export_context(uuid,uuid,uuid),
  public.save_roster_export_preview(uuid,uuid,uuid,jsonb,text[],text,text,text,jsonb,text),
  public.confirm_roster_export_preview(uuid,text,text,text),
  public.retry_integration_sync_job(uuid,uuid,text)
to authenticated;
grant execute on function public.claim_integration_outbox_jobs(text,integer,integer),
  public.authorize_integration_outbox_submission(uuid,uuid,bigint),
  public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb),
  public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)
to service_role;
