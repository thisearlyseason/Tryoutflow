-- Once a provider request may have crossed the network boundary, source
-- invalidation and retry exhaustion are no longer proof of non-delivery.
alter table public.outbox_jobs
  add column delivery_uncertain_at timestamptz,
  add column delivery_uncertain_reason text;

alter table public.outbox_jobs drop constraint outbox_jobs_status;
alter table public.outbox_jobs add constraint outbox_jobs_status
  check(status in ('pending','leased','completed','dead_letter','cancelled','needs_attention'));
alter table public.outbox_jobs drop constraint outbox_jobs_terminal_shape;
alter table public.outbox_jobs add constraint outbox_jobs_terminal_shape check (
  (status='completed' and completed_at is not null and dead_lettered_at is null and delivery_uncertain_at is null)
  or (status in ('dead_letter','cancelled') and dead_lettered_at is not null and completed_at is null and delivery_uncertain_at is null)
  or (status in ('pending','leased') and completed_at is null and dead_lettered_at is null and delivery_uncertain_at is null)
  or (status='needs_attention' and completed_at is null and dead_lettered_at is null
    and provider_submission_started_at is not null and delivery_uncertain_at is not null)
);
alter table public.outbox_jobs add constraint outbox_jobs_delivery_uncertain_reason check (
  (status='needs_attention' and delivery_uncertain_reason ~ '^[a-z][a-z0-9_]{2,63}$')
  or (status<>'needs_attention' and delivery_uncertain_reason is null)
);

alter table public.communication_messages drop constraint communication_messages_state;
alter table public.communication_messages add constraint communication_messages_state
  check(state in ('queued','submitted','delivered','failed','bounced','cancelled','suppressed','delivery_uncertain'));
alter table public.communication_messages drop constraint communication_messages_submission_consistency;
alter table public.communication_messages add constraint communication_messages_submission_consistency check (
  (state in ('queued','failed','cancelled','suppressed','delivery_uncertain') and provider_message_id is null)
  or (state in ('submitted','delivered','bounced') and submitted_at is not null and provider_message_id is not null)
);

-- Every provider-start authorization is retained, so a response which arrives
-- after lease expiry/source invalidation can still prove its exact handoff.
alter table public.outbox_jobs add constraint outbox_jobs_organization_id_id_key
  unique(organization_id,id);
create table public.outbox_provider_handoffs (
  organization_id uuid not null,
  job_id uuid not null,
  lease_token uuid not null,
  lease_generation bigint not null check(lease_generation>0),
  started_at timestamptz not null default clock_timestamp(),
  primary key(job_id,lease_token,lease_generation),
  foreign key(organization_id,job_id) references public.outbox_jobs(organization_id,id) on delete cascade
);
alter table public.outbox_provider_handoffs enable row level security;
revoke all on public.outbox_provider_handoffs from public,anon,authenticated,service_role;

-- Lock order for every execution/cancellation path is: primary mutable source,
-- message, then job. Reading identifiers before locking is safe because source
-- bindings are server-owned; every job predicate is rechecked after its lock.
create function private.lock_communication_primary_source(p_message_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare binding record;
begin
  select source_kind,source_id,source_registration_id,source_roster_version_id
  into binding from public.communication_messages where id=p_message_id;
  if not found then return; end if;
  if binding.source_kind='registration' then
    perform 1 from public.tryout_registrations where id=binding.source_registration_id for share;
  elsif binding.source_kind='roster_decision' then
    perform 1 from public.roster_versions where id=binding.source_roster_version_id for share;
  elsif binding.source_kind='invitation' then
    perform 1 from public.organization_invitations where id=binding.source_id for share;
  end if;
end $$;

create function private.mark_outbox_delivery_uncertain(p_job_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare seed record; target record;
begin
  if p_reason !~ '^[a-z][a-z0-9_]{2,63}$' then
    raise exception 'invalid uncertainty reason' using errcode='22023';
  end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  perform 1 from public.communication_messages where id=seed.message_id for update;
  update public.outbox_jobs set status='needs_attention',last_error_code=p_reason,
    delivery_uncertain_at=coalesce(delivery_uncertain_at,clock_timestamp()),
    delivery_uncertain_reason=p_reason,lease_expires_at=null
  where id=p_job_id and status in ('pending','leased','needs_attention')
    and provider_submission_started_at is not null
  returning organization_id,message_id into target;
  if not found then return; end if;
  update public.communication_messages set state='delivery_uncertain',cancellation_reason=null,
    attention_required_at=coalesce(attention_required_at,clock_timestamp())
  where id=target.message_id and state in ('queued','delivery_uncertain');
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  select target.organization_id,null,'communication.delivery_uncertain','communication_message',target.message_id,
    jsonb_build_object('reason',p_reason)
  where not exists(select 1 from public.audit_logs audit where audit.organization_id=target.organization_id
    and audit.action='communication.delivery_uncertain' and audit.entity_id=target.message_id
    and audit.details->>'reason'=p_reason);
end $$;

create or replace function private.cancel_outbox_message(p_job_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare seed record; target record;
begin
  if p_reason !~ '^[a-z][a-z0-9_]{2,63}$' then raise exception 'invalid cancellation reason' using errcode='22023'; end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  perform 1 from public.communication_messages where id=seed.message_id for update;
  if exists(select 1 from public.outbox_jobs where id=p_job_id and status in ('pending','leased','needs_attention')
    and provider_submission_started_at is not null) then
    perform private.mark_outbox_delivery_uncertain(p_job_id,p_reason);
    return;
  end if;
  update public.outbox_jobs set status='cancelled',last_error_code=p_reason,
    lease_owner=null,lease_token=null,lease_expires_at=null,dead_lettered_at=clock_timestamp()
  where id=p_job_id and status in ('pending','leased') and provider_submission_started_at is null
  returning organization_id,message_id into target;
  if not found then return; end if;
  update public.communication_messages set
    state=case when p_reason='optional_suppressed' then 'suppressed' else 'cancelled' end,
    cancellation_reason=p_reason,attention_required_at=clock_timestamp()
  where id=target.message_id and state='queued';
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(target.organization_id,null,'communication.cancelled','communication_message',target.message_id,
    jsonb_build_object('reason',p_reason));
end $$;

create or replace function public.rotate_registration_confirmation_token(p_registration_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare target public.tryout_registrations%rowtype; raw_token text; stale record;
begin
  select * into target from public.tryout_registrations where id=p_registration_id for update;
  if not found then return null; end if;
  for stale in
    select job.id from public.communication_messages message
    join public.outbox_jobs job on job.message_id=message.id
    where message.organization_id=target.organization_id and message.source_kind='registration'
      and message.source_registration_id=target.id and message.message_kind='registration_confirmation'
      and job.status in ('pending','leased','needs_attention')
  loop perform private.cancel_outbox_message(stale.id,'confirmation_token_superseded'); end loop;
  update public.registration_confirmation_tokens set revoked_at=clock_timestamp()
  where organization_id=target.organization_id and registration_id=target.id
    and purpose='registration_confirmation' and used_at is null and revoked_at is null;
  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.registration_confirmation_tokens(organization_id,registration_id,token_digest,expires_at)
  values(target.organization_id,target.id,encode(extensions.digest(raw_token,'sha256'),'hex'),clock_timestamp()+interval '7 days');
  return raw_token;
end $$;

create or replace function public.queue_registration_confirmation_communication_v2(
  p_registration_id uuid,p_guardian_email text,p_confirmation_token_digest text,
  p_subject text,p_text text,p_business_idempotency_key text
) returns public.queue_communication_result language plpgsql security definer set search_path='' as $$
declare source record; existing record; created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  recipient jsonb; content jsonb; digest text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_confirmation_token_digest !~ '^[0-9a-f]{64}$' or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
    or length(p_subject) not between 1 and 200 or length(p_text) not between 1 and 20000
    then return ('invalid_input'::text,null::uuid,null::uuid); end if;
  -- The registration is the first lock for queue, replay/rotation, claim,
  -- authorize and cancellation paths.
  perform 1 from public.tryout_registrations where id=p_registration_id for share;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  select registration.organization_id,guardian.id guardian_id,guardian.email::text email into source
  from public.tryout_registrations registration
  join public.organizations organization on organization.id=registration.organization_id and organization.status='active'
  join public.athlete_guardians link on link.organization_id=registration.organization_id and link.athlete_id=registration.athlete_id
  join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
  join public.registration_confirmation_tokens token on token.organization_id=registration.organization_id
    and token.registration_id=registration.id and token.token_digest=p_confirmation_token_digest
    and token.used_at is null and token.revoked_at is null and token.expires_at>clock_timestamp()
  where registration.id=p_registration_id and registration.status='submitted'
    and guardian.normalized_email=public.normalize_registration_text(p_guardian_email)
  order by link.is_primary_contact desc,guardian.id limit 1 for share of registration,organization,link,guardian,token;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  recipient:=jsonb_build_object('email',lower(trim(source.email)));
  content:=jsonb_build_object('subject',p_subject,'text',p_text);
  digest:=encode(extensions.digest(convert_to(concat_ws(E'\n',p_registration_id,source.guardian_id,p_confirmation_token_digest,recipient::text,content::text),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(source.organization_id::text||':'||p_business_idempotency_key,0));
  select id,request_digest,source_binding_version into existing from public.communication_messages
    where organization_id=source.organization_id and business_idempotency_key=p_business_idempotency_key;
  if found then return case when existing.source_binding_version=1 and existing.request_digest=digest
    then ('replayed'::text,existing.id,(select id from public.outbox_jobs where message_id=existing.id))::public.queue_communication_result
    else ('idempotency_conflict'::text,null::uuid,null::uuid)::public.queue_communication_result end; end if;
  for existing in select job.id from public.outbox_jobs job join public.communication_messages message on message.id=job.message_id
    where message.organization_id=source.organization_id and message.source_registration_id=p_registration_id
      and message.message_kind='registration_confirmation' and message.source_confirmation_token_digest<>p_confirmation_token_digest
      and job.status in ('pending','leased','needs_attention')
  loop perform private.cancel_outbox_message(existing.id,'confirmation_token_superseded'); end loop;
  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
    business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
    source_registration_id,source_guardian_id,source_confirmation_token_digest)
  values(created_message,source.organization_id,'registration',p_registration_id,'registration_confirmation','operational',
    p_business_idempotency_key,digest,recipient,content,1,p_registration_id,source.guardian_id,p_confirmation_token_digest);
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,source.organization_id,created_message,p_business_idempotency_key,'communication:'||created_message);
  return ('queued'::text,created_message,created_job);
end $$;

create or replace function public.queue_registration_communication_v2(
  p_organization_id uuid,p_registration_id uuid,p_guardian_id uuid,p_command_kind text,
  p_subject text,p_text text,p_business_idempotency_key text
) returns public.queue_communication_result language plpgsql security definer set search_path='' as $$
declare source record; existing record; created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  recipient jsonb; content jsonb; digest text;
begin
  if auth.uid() is null or p_command_kind<>'registration_reminder'
    or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
    or length(p_subject) not between 1 and 200 or length(p_text) not between 1 and 20000
    then return ('invalid_input'::text,null::uuid,null::uuid); end if;
  perform 1 from public.tryout_registrations registration
    where registration.organization_id=p_organization_id and registration.id=p_registration_id for share;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  perform 1 from public.organization_members member where member.organization_id=p_organization_id
    and member.user_id=auth.uid() and member.status='active' and member.role in ('owner','administrator') for share;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  select guardian.email::text email,link.communication_permitted,
    coalesce(preference.optional_email_enabled,true) optional_email_enabled into source
  from public.tryout_registrations registration
  join public.organizations organization on organization.id=registration.organization_id and organization.status='active'
  join public.athlete_guardians link on link.organization_id=registration.organization_id
    and link.athlete_id=registration.athlete_id and link.guardian_id=p_guardian_id
  join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
  left join public.notification_preferences preference on preference.organization_id=guardian.organization_id and preference.guardian_id=guardian.id
  where registration.organization_id=p_organization_id and registration.id=p_registration_id and registration.status='submitted'
  for share of registration,organization,link,guardian;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  if not source.communication_permitted or not source.optional_email_enabled then return ('suppressed'::text,null::uuid,null::uuid); end if;
  recipient:=jsonb_build_object('email',lower(trim(source.email)));
  content:=jsonb_build_object('subject',p_subject,'text',p_text);
  digest:=encode(extensions.digest(convert_to(concat_ws(E'\n',p_registration_id,p_guardian_id,p_command_kind,'optional',recipient::text,content::text),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_business_idempotency_key,0));
  select id,request_digest,source_binding_version into existing from public.communication_messages
    where organization_id=p_organization_id and business_idempotency_key=p_business_idempotency_key;
  if found then return case when existing.source_binding_version=1 and existing.request_digest=digest
    then ('replayed'::text,existing.id,(select id from public.outbox_jobs where message_id=existing.id))::public.queue_communication_result
    else ('idempotency_conflict'::text,null::uuid,null::uuid)::public.queue_communication_result end; end if;
  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
    business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
    source_registration_id,source_guardian_id,source_authorizing_user_id)
  values(created_message,p_organization_id,'registration',p_registration_id,p_command_kind,'optional',
    p_business_idempotency_key,digest,recipient,content,1,p_registration_id,p_guardian_id,auth.uid());
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,p_organization_id,created_message,p_business_idempotency_key,'communication:'||created_message);
  return ('queued'::text,created_message,created_job);
end $$;

create or replace function public.queue_invitation_communication_v2(
  p_organization_id uuid,p_invitation_id uuid,p_invitation_token_digest text,
  p_subject text,p_text text,p_business_idempotency_key text
) returns public.queue_communication_result language plpgsql security definer set search_path='' as $$
declare source record; existing record; created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  recipient jsonb; content jsonb; digest text;
begin
  if p_invitation_token_digest !~ '^[0-9a-f]{64}$' or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
    or length(p_subject) not between 1 and 200 or length(p_text) not between 1 and 20000
    then return ('invalid_input'::text,null::uuid,null::uuid); end if;
  perform 1 from public.organization_invitations invitation
    where invitation.organization_id=p_organization_id and invitation.id=p_invitation_id for share;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  select invitation.email::text email,invitation.role,invitation.expires_at,invitation.created_by_user_id into source
  from public.organization_invitations invitation
  join public.organizations organization on organization.id=invitation.organization_id and organization.status='active'
  join public.organization_members member on member.organization_id=invitation.organization_id
    and member.user_id=invitation.created_by_user_id and member.status='active' and member.role in ('owner','administrator')
  where invitation.organization_id=p_organization_id and invitation.id=p_invitation_id
    and invitation.token_digest=p_invitation_token_digest and invitation.accepted_at is null
    and invitation.revoked_at is null and invitation.expires_at>clock_timestamp()
    and (auth.role()='service_role' or auth.uid()=invitation.created_by_user_id)
  for share of invitation,organization,member;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  recipient:=jsonb_build_object('email',lower(trim(source.email)));
  content:=jsonb_build_object('subject',p_subject,'text',p_text);
  digest:=encode(extensions.digest(convert_to(concat_ws(E'\n',p_invitation_id,p_invitation_token_digest,source.role,source.expires_at,recipient::text,content::text),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_business_idempotency_key,0));
  select id,request_digest,source_binding_version into existing from public.communication_messages
    where organization_id=p_organization_id and business_idempotency_key=p_business_idempotency_key;
  if found then return case when existing.source_binding_version=1 and existing.request_digest=digest
    then ('replayed'::text,existing.id,(select id from public.outbox_jobs where message_id=existing.id))::public.queue_communication_result
    else ('idempotency_conflict'::text,null::uuid,null::uuid)::public.queue_communication_result end; end if;
  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
    business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
    source_invitation_token_digest,source_authorizing_user_id)
  values(created_message,p_organization_id,'invitation',p_invitation_id,'member_invitation','operational',
    p_business_idempotency_key,digest,recipient,content,1,p_invitation_token_digest,source.created_by_user_id);
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,p_organization_id,created_message,p_business_idempotency_key,'communication:'||created_message);
  return ('queued'::text,created_message,created_job);
end $$;

create or replace function public.queue_roster_decision_communication_v2(
  p_organization_id uuid,p_roster_version_id uuid,p_registration_id uuid,p_guardian_id uuid,
  p_expected_decision text,p_command_kind text,p_subject text,p_text text,p_business_idempotency_key text
) returns public.queue_communication_result language plpgsql security definer set search_path='' as $$
declare source record; existing record; created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  recipient jsonb; content jsonb; digest text;
begin
  if auth.uid() is null or p_command_kind<>'roster_decision_notice'
    or p_expected_decision not in ('callback','selected','waitlisted','released')
    or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
    or length(p_subject) not between 1 and 200 or length(p_text) not between 1 and 20000
    then return ('invalid_input'::text,null::uuid,null::uuid); end if;
  perform 1 from public.roster_versions version
    where version.organization_id=p_organization_id and version.id=p_roster_version_id for share;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  select version.tryout_id,version.division_id,guardian.email::text email into source
  from public.roster_versions version
  join public.organizations organization on organization.id=version.organization_id and organization.status='active'
  join public.roster_decisions decision on decision.organization_id=version.organization_id and decision.roster_version_id=version.id
    and decision.registration_id=p_registration_id and decision.status=p_expected_decision
  join public.tryout_registrations registration on registration.organization_id=decision.organization_id
    and registration.id=decision.registration_id and registration.status='submitted'
  join public.athlete_guardians link on link.organization_id=registration.organization_id
    and link.athlete_id=registration.athlete_id and link.guardian_id=p_guardian_id
  join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
  where version.organization_id=p_organization_id and version.id=p_roster_version_id and version.state='finalized'
  for share of version,organization,decision,registration,link,guardian;
  if not found or not private.can_user_authorize_roster_notice(auth.uid(),p_organization_id,source.tryout_id,source.division_id)
    then return ('forbidden'::text,null::uuid,null::uuid); end if;
  recipient:=jsonb_build_object('email',lower(trim(source.email))); content:=jsonb_build_object('subject',p_subject,'text',p_text);
  digest:=encode(extensions.digest(convert_to(concat_ws(E'\n',p_roster_version_id,p_registration_id,p_guardian_id,p_expected_decision,p_command_kind,recipient::text,content::text),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_business_idempotency_key,0));
  select id,request_digest,source_binding_version into existing from public.communication_messages where organization_id=p_organization_id and business_idempotency_key=p_business_idempotency_key;
  if found then return case when existing.source_binding_version=1 and existing.request_digest=digest
    then ('replayed'::text,existing.id,(select id from public.outbox_jobs where message_id=existing.id))::public.queue_communication_result
    else ('idempotency_conflict'::text,null::uuid,null::uuid)::public.queue_communication_result end; end if;
  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,
    request_digest,recipient_snapshot,content_snapshot,source_binding_version,source_registration_id,source_guardian_id,
    source_roster_version_id,source_expected_decision,source_authorizing_user_id)
  values(created_message,p_organization_id,'roster_decision',p_roster_version_id,p_command_kind,'operational',p_business_idempotency_key,
    digest,recipient,content,1,p_registration_id,p_guardian_id,p_roster_version_id,p_expected_decision,auth.uid());
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,p_organization_id,created_message,p_business_idempotency_key,'communication:'||created_message);
  return ('queued'::text,created_message,created_job);
end $$;

create or replace function public.claim_outbox_jobs(p_lease_owner text,p_batch_size integer,p_lease_seconds integer)
returns setof public.claimed_outbox_job language plpgsql security definer set search_path='' as $$
declare candidate record; leased public.outbox_jobs%rowtype; message public.communication_messages%rowtype;
  result public.claimed_outbox_job; reason text; handled_count integer:=0;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$' or p_batch_size not between 1 and 50 or p_lease_seconds not between 30 and 300
    then raise exception 'invalid job claim' using errcode='22023'; end if;
  for candidate in select job.id,job.message_id from public.outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp()) and job.attempt_count>=job.max_attempts
    order by job.available_at,job.created_at,job.id limit p_batch_size
  loop
    perform private.lock_communication_primary_source(candidate.message_id);
    perform 1 from public.communication_messages where id=candidate.message_id for update;
    select * into leased from public.outbox_jobs job where job.id=candidate.id
      and job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp()) and job.attempt_count>=job.max_attempts
      for update skip locked;
    if not found then continue; end if;
    if leased.provider_submission_started_at is not null then
      perform private.mark_outbox_delivery_uncertain(leased.id,'lease_attempts_exhausted');
    else
      update public.outbox_jobs set status='dead_letter',last_error_code='lease_attempts_exhausted',
        lease_owner=null,lease_token=null,lease_expires_at=null,dead_lettered_at=clock_timestamp() where id=leased.id;
      update public.communication_messages set state='failed',attention_required_at=clock_timestamp() where id=leased.message_id;
    end if;
  end loop;
  for candidate in select job.id,job.message_id from public.outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp()) and job.attempt_count<job.max_attempts
    order by job.available_at,job.created_at,job.id limit p_batch_size*2
  loop
    perform private.lock_communication_primary_source(candidate.message_id);
    reason:=private.lock_communication_source_reason(candidate.message_id);
    select * into leased from public.outbox_jobs job where job.id=candidate.id
      and job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp()) and job.attempt_count<job.max_attempts
      for update skip locked;
    if not found then continue; end if;
    handled_count:=handled_count+1;
    if reason is not null then
      if leased.provider_submission_started_at is not null then
        perform private.mark_outbox_delivery_uncertain(leased.id,reason);
      else
        perform private.cancel_outbox_message(leased.id,reason);
      end if;
      if handled_count>=p_batch_size then return; end if;
      continue;
    end if;
    update public.outbox_jobs set status='leased',attempt_count=attempt_count+1,lease_owner=p_lease_owner,
      lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null
    where id=leased.id returning * into leased;
    select * into message from public.communication_messages where id=leased.message_id;
    result:=(leased.id,leased.message_id,leased.lease_token,leased.lease_generation,leased.lease_expires_at,
      leased.provider_idempotency_key,message.recipient_snapshot->>'email',message.content_snapshot->>'subject',
      message.content_snapshot->>'text',leased.attempt_count,leased.max_attempts);
    return next result;
    if handled_count>=p_batch_size then return; end if;
  end loop;
end $$;

create or replace function public.authorize_outbox_job_send(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint)
returns text language plpgsql security definer set search_path='' as $$
declare seed record; target public.outbox_jobs%rowtype; reason text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return 'not_found'; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  reason:=private.lock_communication_source_reason(seed.message_id);
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token
    or target.lease_generation<>p_lease_generation or target.lease_expires_at<=clock_timestamp()
    then return 'lease_conflict'; end if;
  if reason is not null then
    perform private.cancel_outbox_message(target.id,reason);
    return case when target.provider_submission_started_at is null then 'cancelled' else 'needs_attention' end;
  end if;
  insert into public.outbox_provider_handoffs(organization_id,job_id,lease_token,lease_generation)
  values(target.organization_id,target.id,p_lease_token,p_lease_generation) on conflict do nothing;
  update public.outbox_jobs set provider_submission_started_at=coalesce(provider_submission_started_at,clock_timestamp())
    where id=target.id;
  return 'authorized';
end $$;

create or replace function public.complete_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_provider_message_id text)
returns text language plpgsql security definer set search_path='' as $$
declare seed record; target public.outbox_jobs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_provider_message_id is null or p_provider_message_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then return 'invalid_input'; end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return 'not_found'; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  perform 1 from public.communication_messages where id=seed.message_id for update;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if target.status='completed' then return case when (select provider_message_id from public.communication_messages where id=target.message_id)=p_provider_message_id then 'replayed' else 'terminal_conflict' end; end if;
  if target.status not in ('leased','pending','needs_attention') or not exists(
    select 1 from public.outbox_provider_handoffs handoff where handoff.job_id=target.id
      and handoff.lease_token=p_lease_token and handoff.lease_generation=p_lease_generation
  ) then return 'lease_conflict'; end if;
  update public.outbox_jobs set status='completed',completed_at=clock_timestamp(),dead_lettered_at=null,
    delivery_uncertain_at=null,delivery_uncertain_reason=null,last_error_code=null,
    lease_owner=null,lease_token=null,lease_expires_at=null where id=p_job_id;
  update public.communication_messages set state='submitted',provider_message_id=p_provider_message_id,
    submitted_at=clock_timestamp(),attention_required_at=null,cancellation_reason=null where id=target.message_id;
  return 'completed';
end $$;

create or replace function public.fail_outbox_job(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_error_code text,p_retryable boolean
) returns text language plpgsql security definer set search_path='' as $$
declare seed record; target public.outbox_jobs%rowtype; terminal boolean;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_error_code !~ '^[a-z][a-z0-9_]{2,63}$' then return 'invalid_input'; end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return 'not_found'; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  perform 1 from public.communication_messages where id=seed.message_id for update;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation then return 'lease_conflict'; end if;
  if target.status='dead_letter' then return case when target.last_error_code=p_error_code then 'replayed' else 'terminal_conflict' end; end if;
  if target.status<>'leased' or target.lease_expires_at<=clock_timestamp() then return 'lease_conflict'; end if;
  terminal:=not p_retryable or target.attempt_count>=target.max_attempts;
  if terminal and p_retryable and target.provider_submission_started_at is not null then
    perform private.mark_outbox_delivery_uncertain(target.id,p_error_code);
    return 'needs_attention';
  elsif terminal then
    update public.outbox_jobs set status='dead_letter',last_error_code=p_error_code,dead_lettered_at=clock_timestamp(),
      lease_owner=null,lease_token=null,lease_expires_at=null where id=p_job_id;
    update public.communication_messages set state='failed',attention_required_at=clock_timestamp() where id=target.message_id;
    return 'dead_lettered';
  end if;
  update public.outbox_jobs set status='pending',last_error_code=p_error_code,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,
      30*(2::numeric^greatest(0,target.attempt_count-1))
      +((hashtextextended(target.id::text||':'||target.lease_generation::text,0)&1023)%11)
    )::integer)
  where id=p_job_id;
  return 'retry_scheduled';
end $$;

revoke all on public.outbox_provider_handoffs from public,anon,authenticated,service_role;
revoke all on function private.lock_communication_primary_source(uuid),
  private.mark_outbox_delivery_uncertain(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.authorize_outbox_job_send(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.authorize_outbox_job_send(uuid,uuid,bigint) to service_role;
