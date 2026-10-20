-- Bind every deliverable message to the exact mutable source facts which made it
-- eligible. Rows created before this migration cannot be proven safe and are
-- failed closed instead of being sent from an old recipient snapshot.
alter table public.communication_messages
  add column source_binding_version smallint not null default 0,
  add column source_registration_id uuid,
  add column source_guardian_id uuid,
  add column source_roster_version_id uuid,
  add column source_expected_decision text,
  add column source_confirmation_token_digest text,
  add column source_invitation_token_digest text,
  add column source_authorizing_user_id uuid,
  add column cancellation_reason text;

update public.communication_messages
set recipient_snapshot=recipient_snapshot-'name';

update public.outbox_jobs
set status='cancelled',last_error_code='legacy_source_unverifiable',
  lease_owner=null,lease_token=null,lease_expires_at=null,
  dead_lettered_at=clock_timestamp()
where status in ('pending','leased');
update public.communication_messages
set state='cancelled',cancellation_reason='legacy_source_unverifiable',
  attention_required_at=clock_timestamp()
where state='queued' and source_binding_version=0;

alter table public.communication_messages alter column source_binding_version set default 1;
alter table public.communication_messages drop constraint communication_messages_recipient_shape;
alter table public.communication_messages add constraint communication_messages_recipient_shape check (
  jsonb_typeof(recipient_snapshot)='object'
  and recipient_snapshot ? 'email'
  and jsonb_typeof(recipient_snapshot->'email')='string'
  and length(recipient_snapshot->>'email') between 3 and 320
  and (recipient_snapshot-array['email']::text[])='{}'::jsonb
);
alter table public.communication_messages drop constraint communication_messages_state;
alter table public.communication_messages add constraint communication_messages_state
  check(state in ('queued','submitted','delivered','failed','bounced','cancelled','suppressed'));
alter table public.communication_messages drop constraint communication_messages_submission_consistency;
alter table public.communication_messages add constraint communication_messages_submission_consistency check (
  (state in ('queued','failed','cancelled','suppressed') and provider_message_id is null)
  or (state in ('submitted','delivered','bounced') and submitted_at is not null and provider_message_id is not null)
);
alter table public.communication_messages add constraint communication_messages_cancellation_reason check (
  (state in ('cancelled','suppressed') and cancellation_reason ~ '^[a-z][a-z0-9_]{2,63}$')
  or (state not in ('cancelled','suppressed') and cancellation_reason is null)
);
alter table public.communication_messages add constraint communication_messages_source_binding check (
  source_binding_version=0 or (
    source_binding_version=1 and (
      (source_kind='registration' and source_guardian_id is not null and source_registration_id=source_id and source_roster_version_id is null
        and source_expected_decision is null and source_invitation_token_digest is null
        and (
          (message_kind='registration_confirmation' and source_confirmation_token_digest ~ '^[0-9a-f]{64}$'
            and source_authorizing_user_id is null)
          or
          (message_kind='registration_reminder' and source_confirmation_token_digest is null
            and source_authorizing_user_id is not null)
        ))
      or
      (source_kind='roster_decision' and source_guardian_id is not null and source_roster_version_id=source_id and source_registration_id is not null
        and source_expected_decision in ('callback','selected','waitlisted','released')
        and source_confirmation_token_digest is null and source_invitation_token_digest is null
        and source_authorizing_user_id is not null)
      or
      (source_kind='invitation' and source_guardian_id is null and source_registration_id is null and source_roster_version_id is null
        and source_expected_decision is null and source_confirmation_token_digest is null
        and source_invitation_token_digest ~ '^[0-9a-f]{64}$' and source_authorizing_user_id is not null)
    )
  )
);
alter table public.communication_messages add constraint communication_messages_confirmation_digest check (
  source_confirmation_token_digest is null or source_confirmation_token_digest ~ '^[0-9a-f]{64}$'
);
alter table public.communication_messages add constraint communication_messages_server_owned_kind check (
  source_binding_version=0 or
  (source_kind='registration' and message_kind='registration_confirmation' and notice_class='operational') or
  (source_kind='registration' and message_kind='registration_reminder' and notice_class='optional') or
  (source_kind='roster_decision' and message_kind='roster_decision_notice' and notice_class='operational') or
  (source_kind='invitation' and message_kind='member_invitation' and notice_class='operational')
);

alter table public.outbox_jobs drop constraint outbox_jobs_status;
alter table public.outbox_jobs add column provider_submission_started_at timestamptz;
alter table public.outbox_jobs add constraint outbox_jobs_status
  check(status in ('pending','leased','completed','dead_letter','cancelled'));
alter table public.outbox_jobs drop constraint outbox_jobs_terminal_shape;
alter table public.outbox_jobs add constraint outbox_jobs_terminal_shape check (
  (status='completed' and completed_at is not null and dead_lettered_at is null)
  or (status in ('dead_letter','cancelled') and dead_lettered_at is not null and completed_at is null)
  or (status in ('pending','leased') and completed_at is null and dead_lettered_at is null)
);

create or replace function private.cancel_outbox_message(p_job_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare target record;
begin
  if p_reason !~ '^[a-z][a-z0-9_]{2,63}$' then raise exception 'invalid cancellation reason' using errcode='22023'; end if;
  update public.outbox_jobs set status='cancelled',last_error_code=p_reason,
    lease_owner=null,lease_token=null,lease_expires_at=null,dead_lettered_at=clock_timestamp()
  where id=p_job_id and status in ('pending','leased')
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

create or replace function private.can_user_authorize_roster_notice(
  p_user_id uuid,p_organization_id uuid,p_tryout_id uuid,p_division_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare member_role text;
begin
  select member.role into member_role from public.organization_members member
  where member.organization_id=p_organization_id and member.user_id=p_user_id and member.status='active'
  for share;
  if not found then return false; end if;
  if member_role in ('owner','administrator') then return true; end if;
  perform 1 from public.tryout_staff_assignments assignment
  where assignment.organization_id=p_organization_id and assignment.user_id=p_user_id
    and assignment.tryout_id=p_tryout_id and assignment.role='director'
    and assignment.revoked_at is null
    and (assignment.expires_at is null or assignment.expires_at>clock_timestamp())
    and (assignment.scope_kind='tryout' or (assignment.scope_kind='division' and assignment.division_id=p_division_id))
  for share;
  return found;
end
$$;

create function private.lock_communication_source_reason(p_message_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare message public.communication_messages%rowtype; source record;
begin
  select * into message from public.communication_messages where id=p_message_id for update;
  if not found or message.state<>'queued' then return 'message_not_queued'; end if;
  if message.source_binding_version<>1 then return 'source_unverifiable'; end if;
  perform 1 from public.organizations where id=message.organization_id and status='active' for share;
  if not found then return 'organization_inactive'; end if;

  if message.source_kind='registration' then
    select registration.status,registration.athlete_id,guardian.email::text as email,
      link.communication_permitted,coalesce(preference.optional_email_enabled,true) optional_email_enabled
    into source
    from public.tryout_registrations registration
    join public.athlete_guardians link on link.organization_id=registration.organization_id
      and link.athlete_id=registration.athlete_id and link.guardian_id=message.source_guardian_id
    join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
    left join public.notification_preferences preference on preference.organization_id=guardian.organization_id and preference.guardian_id=guardian.id
    where registration.organization_id=message.organization_id and registration.id=message.source_registration_id
    for share of registration,link,guardian;
    if not found or source.status<>'submitted' then return 'registration_ineligible'; end if;
    if lower(trim(source.email)) is distinct from message.recipient_snapshot->>'email' then return 'recipient_changed'; end if;
    if message.notice_class='optional' and (not source.communication_permitted or not source.optional_email_enabled) then return 'optional_suppressed'; end if;
    if message.message_kind='registration_confirmation' then
      perform 1 from public.registration_confirmation_tokens token
      where token.organization_id=message.organization_id and token.registration_id=message.source_registration_id
        and token.token_digest=message.source_confirmation_token_digest and token.purpose='registration_confirmation'
        and token.used_at is null and token.revoked_at is null and token.expires_at>clock_timestamp()
      for share;
      if not found then return 'confirmation_token_superseded'; end if;
    elsif message.message_kind='registration_reminder' then
      if message.source_authorizing_user_id is null or not exists(
        select 1 from public.organization_members member
        where member.organization_id=message.organization_id and member.user_id=message.source_authorizing_user_id
          and member.status='active' and member.role in ('owner','administrator') for share
      ) then return 'authorizer_offboarded'; end if;
    else return 'message_kind_invalid'; end if;
    return null;
  elsif message.source_kind='roster_decision' then
    select version.tryout_id,version.division_id,version.state,version.revision_number,
      decision.status,registration.status registration_status,guardian.email::text email,
      link.communication_permitted,coalesce(preference.optional_email_enabled,true) optional_email_enabled
    into source
    from public.roster_versions version
    join public.roster_decisions decision on decision.organization_id=version.organization_id
      and decision.roster_version_id=version.id and decision.registration_id=message.source_registration_id
    join public.tryout_registrations registration on registration.organization_id=decision.organization_id
      and registration.id=decision.registration_id
    join public.athlete_guardians link on link.organization_id=registration.organization_id
      and link.athlete_id=registration.athlete_id and link.guardian_id=message.source_guardian_id
    join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
    left join public.notification_preferences preference on preference.organization_id=guardian.organization_id and preference.guardian_id=guardian.id
    where version.organization_id=message.organization_id and version.id=message.source_roster_version_id
    for share of version,decision,registration,link,guardian;
    if not found or source.state<>'finalized' or source.status<>message.source_expected_decision
      or source.registration_status<>'submitted' then return 'roster_decision_superseded'; end if;
    -- Revision/finalization paths update-lock every existing version in the
    -- scope. Matching share locks therefore fence a concurrent supersession
    -- until this authorization transaction has finished.
    perform 1 from public.roster_versions version
    where version.organization_id=message.organization_id and version.tryout_id=source.tryout_id
      and version.division_id=source.division_id
    order by version.revision_number,version.id for share;
    if exists(select 1 from public.roster_versions newer where newer.organization_id=message.organization_id
      and newer.tryout_id=source.tryout_id and newer.division_id=source.division_id and newer.state='finalized'
      and newer.revision_number>source.revision_number) then return 'roster_decision_superseded'; end if;
    if lower(trim(source.email)) is distinct from message.recipient_snapshot->>'email' then return 'recipient_changed'; end if;
    if message.notice_class='optional' and (not source.communication_permitted or not source.optional_email_enabled) then return 'optional_suppressed'; end if;
    if not private.can_user_authorize_roster_notice(message.source_authorizing_user_id,message.organization_id,source.tryout_id,source.division_id)
      then return 'authorizer_offboarded'; end if;
    return null;
  elsif message.source_kind='invitation' then
    select invitation.email::text email,invitation.token_digest,invitation.accepted_at,invitation.revoked_at,
      invitation.expires_at,invitation.created_by_user_id
    into source from public.organization_invitations invitation
    where invitation.organization_id=message.organization_id and invitation.id=message.source_id for share;
    if not found or source.accepted_at is not null or source.revoked_at is not null
      or source.expires_at<=clock_timestamp() or source.token_digest<>message.source_invitation_token_digest
      then return 'invitation_inactive'; end if;
    if lower(trim(source.email)) is distinct from message.recipient_snapshot->>'email' then return 'recipient_changed'; end if;
    if source.created_by_user_id<>message.source_authorizing_user_id or not exists(
      select 1 from public.organization_members member where member.organization_id=message.organization_id
        and member.user_id=message.source_authorizing_user_id and member.status='active'
        and member.role in ('owner','administrator') for share
    ) then return 'authorizer_offboarded'; end if;
    return null;
  end if;
  return 'source_unverifiable';
end $$;

-- Token rotation and stale confirmation cancellation share the registration row
-- lock, so exactly one active confirmation intent can remain deliverable.
create or replace function public.rotate_registration_confirmation_token(p_registration_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare target public.tryout_registrations%rowtype; raw_token text; stale record;
begin
  select * into target from public.tryout_registrations where id=p_registration_id;
  if not found then return null; end if;
  -- Match claim/authorize lock order (job, then source) to avoid a rotation
  -- deadlock while preserving a single registration-level rotation winner.
  for stale in
    select job.id from public.outbox_jobs job join public.communication_messages message on message.id=job.message_id
    where message.organization_id=target.organization_id and message.source_kind='registration'
      and message.source_registration_id=target.id and message.message_kind='registration_confirmation'
      and job.status in ('pending','leased') and job.provider_submission_started_at is null for update of job
  loop perform private.cancel_outbox_message(stale.id,'confirmation_token_superseded'); end loop;
  select * into target from public.tryout_registrations where id=p_registration_id for update;
  if not found then return null; end if;
  update public.registration_confirmation_tokens set revoked_at=clock_timestamp()
  where organization_id=target.organization_id and registration_id=target.id
    and purpose='registration_confirmation' and used_at is null and revoked_at is null;
  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.registration_confirmation_tokens(organization_id,registration_id,token_digest,expires_at)
  values(target.organization_id,target.id,encode(extensions.digest(raw_token,'sha256'),'hex'),clock_timestamp()+interval '7 days');
  return raw_token;
end $$;

create function public.queue_registration_communication_v2(
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

create function public.queue_registration_confirmation_communication_v2(
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
  -- Defensive second fence for data created by older application versions.
  for existing in select job.id from public.outbox_jobs job join public.communication_messages message on message.id=job.message_id
    where message.organization_id=source.organization_id and message.source_registration_id=p_registration_id
      and message.message_kind='registration_confirmation' and message.source_confirmation_token_digest<>p_confirmation_token_digest
      and job.status in ('pending','leased') and job.provider_submission_started_at is null for update of job
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

create function public.queue_invitation_communication_v2(
  p_organization_id uuid,p_invitation_id uuid,p_invitation_token_digest text,
  p_subject text,p_text text,p_business_idempotency_key text
) returns public.queue_communication_result language plpgsql security definer set search_path='' as $$
declare source record; existing record; created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  recipient jsonb; content jsonb; digest text;
begin
  if p_invitation_token_digest !~ '^[0-9a-f]{64}$' or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
    or length(p_subject) not between 1 and 200 or length(p_text) not between 1 and 20000
    then return ('invalid_input'::text,null::uuid,null::uuid); end if;
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

create function public.queue_roster_decision_communication_v2(
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
  result public.claimed_outbox_job; reason text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$' or p_batch_size not between 1 and 50 or p_lease_seconds not between 30 and 300
    then raise exception 'invalid job claim' using errcode='22023'; end if;
  -- At most p_batch_size exhausted rows plus p_batch_size claim candidates are
  -- touched per call (a documented 2x batch upper bound).
  for candidate in select job.id,job.message_id from public.outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp()) and job.attempt_count>=job.max_attempts
    order by job.available_at,job.created_at,job.id for update skip locked limit p_batch_size
  loop
    update public.outbox_jobs set status='dead_letter',last_error_code='lease_attempts_exhausted',
      lease_owner=null,lease_token=null,lease_expires_at=null,dead_lettered_at=clock_timestamp() where id=candidate.id
    ;
    update public.communication_messages set state='failed',attention_required_at=clock_timestamp() where id=candidate.message_id;
  end loop;
  for candidate in select job.id,job.message_id from public.outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp()) and job.attempt_count<job.max_attempts
    order by job.available_at,job.created_at,job.id for update skip locked limit p_batch_size
  loop
    reason:=private.lock_communication_source_reason(candidate.message_id);
    if reason is not null then perform private.cancel_outbox_message(candidate.id,reason); continue; end if;
    update public.outbox_jobs set status='leased',attempt_count=attempt_count+1,lease_owner=p_lease_owner,
      lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null,
      provider_submission_started_at=null
    where id=candidate.id returning * into leased;
    select * into message from public.communication_messages where id=leased.message_id;
    result:=(leased.id,leased.message_id,leased.lease_token,leased.lease_generation,leased.lease_expires_at,
      leased.provider_idempotency_key,message.recipient_snapshot->>'email',message.content_snapshot->>'subject',
      message.content_snapshot->>'text',leased.attempt_count,leased.max_attempts);
    return next result;
  end loop;
end $$;

create function public.authorize_outbox_job_send(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint)
returns text language plpgsql security definer set search_path='' as $$
declare target public.outbox_jobs%rowtype; reason text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token
    or target.lease_generation<>p_lease_generation or target.lease_expires_at<=clock_timestamp()
    then return 'lease_conflict'; end if;
  reason:=private.lock_communication_source_reason(target.message_id);
  if reason is not null then perform private.cancel_outbox_message(target.id,reason); return 'cancelled'; end if;
  update public.outbox_jobs set provider_submission_started_at=coalesce(provider_submission_started_at,clock_timestamp())
    where id=target.id;
  return 'authorized';
end $$;

create or replace function public.complete_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_provider_message_id text)
returns text language plpgsql security definer set search_path='' as $$
declare target public.outbox_jobs;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_provider_message_id is null or p_provider_message_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then return 'invalid_input'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status='completed' then return case when (select provider_message_id from public.communication_messages where id=target.message_id)=p_provider_message_id then 'replayed' else 'terminal_conflict' end; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token
    or target.lease_generation<>p_lease_generation or target.lease_expires_at<=clock_timestamp() then return 'lease_conflict'; end if;
  update public.outbox_jobs set status='completed',completed_at=clock_timestamp() where id=p_job_id;
  update public.communication_messages set state='submitted',provider_message_id=p_provider_message_id,submitted_at=clock_timestamp() where id=target.message_id;
  return 'completed';
end $$;

create or replace function public.fail_outbox_job(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_error_code text,p_retryable boolean
) returns text language plpgsql security definer set search_path='' as $$
declare target public.outbox_jobs; terminal boolean;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_error_code !~ '^[a-z][a-z0-9_]{2,63}$' then return 'invalid_input'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation then return 'lease_conflict'; end if;
  if target.status='dead_letter' then return case when target.last_error_code=p_error_code then 'replayed' else 'terminal_conflict' end; end if;
  if target.status<>'leased' or target.lease_expires_at<=clock_timestamp() then return 'lease_conflict'; end if;
  terminal:=not p_retryable or target.attempt_count>=target.max_attempts;
  if terminal then
    update public.outbox_jobs set status='dead_letter',last_error_code=p_error_code,dead_lettered_at=clock_timestamp() where id=p_job_id;
    update public.communication_messages set state='failed',attention_required_at=clock_timestamp() where id=target.message_id;
    return 'dead_lettered';
  end if;
  update public.outbox_jobs set status='pending',last_error_code=p_error_code,
    provider_submission_started_at=null,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,
      30*(2::numeric^greatest(0,target.attempt_count-1))
      +((hashtextextended(target.id::text||':'||target.lease_generation::text,0)&1023)%11)
    )::integer)
  where id=p_job_id;
  return 'retry_scheduled';
end $$;

revoke all on function public.queue_registration_communication(uuid,uuid,uuid,text,text,text,text,text),
  public.queue_registration_confirmation_communication(uuid,text,text,text,text),
  public.queue_invitation_communication(uuid,uuid,text,text,text),
  public.queue_roster_decision_communication(uuid,uuid,uuid,uuid,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.queue_registration_communication_v2(uuid,uuid,uuid,text,text,text,text),
  public.queue_registration_confirmation_communication_v2(uuid,text,text,text,text,text),
  public.queue_invitation_communication_v2(uuid,uuid,text,text,text,text),
  public.queue_roster_decision_communication_v2(uuid,uuid,uuid,uuid,text,text,text,text,text),
  public.authorize_outbox_job_send(uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.queue_registration_communication_v2(uuid,uuid,uuid,text,text,text,text),
  public.queue_roster_decision_communication_v2(uuid,uuid,uuid,uuid,text,text,text,text,text),
  public.queue_invitation_communication_v2(uuid,uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.queue_registration_confirmation_communication_v2(uuid,text,text,text,text,text),
  public.queue_invitation_communication_v2(uuid,uuid,text,text,text,text),
  public.authorize_outbox_job_send(uuid,uuid,bigint) to service_role;
revoke all on function private.cancel_outbox_message(uuid,text),private.can_user_authorize_roster_notice(uuid,uuid,uuid,uuid),
  private.lock_communication_source_reason(uuid) from public,anon,authenticated,service_role;
