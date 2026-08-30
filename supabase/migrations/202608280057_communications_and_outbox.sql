create table public.notification_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  guardian_id uuid not null,
  optional_email_enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,guardian_id),
  constraint notification_preferences_guardian_fkey foreign key (organization_id,guardian_id)
    references public.guardians(organization_id,id) on delete cascade
);
create trigger set_notification_preferences_updated_at before update on public.notification_preferences
for each row execute function public.set_updated_at();

create table public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_kind text not null,
  source_id uuid not null,
  message_kind text not null,
  notice_class text not null,
  business_idempotency_key text not null,
  request_digest text not null,
  recipient_snapshot jsonb not null,
  content_snapshot jsonb not null,
  state text not null default 'queued',
  provider_message_id text,
  submitted_at timestamptz,
  attention_required_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint communication_messages_org_id_key unique (organization_id,id),
  constraint communication_messages_business_key unique (organization_id,business_idempotency_key),
  constraint communication_messages_source_kind check (source_kind in ('registration','roster_decision','invitation')),
  constraint communication_messages_kind check (message_kind ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint communication_messages_notice_class check (notice_class in ('operational','optional')),
  constraint communication_messages_business_key_check check (business_idempotency_key ~ '^[A-Za-z0-9:_-]{16,200}$'),
  constraint communication_messages_digest_check check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_messages_recipient_shape check (
    jsonb_typeof(recipient_snapshot)='object'
    and recipient_snapshot ? 'email'
    and jsonb_typeof(recipient_snapshot->'email')='string'
    and length(recipient_snapshot->>'email') between 3 and 320
    and (recipient_snapshot - array['email','name']::text[])='{}'::jsonb
  ),
  constraint communication_messages_content_shape check (
    jsonb_typeof(content_snapshot)='object'
    and jsonb_typeof(content_snapshot->'subject')='string'
    and length(content_snapshot->>'subject') between 1 and 200
    and jsonb_typeof(content_snapshot->'text')='string'
    and length(content_snapshot->>'text') between 1 and 20000
    and (content_snapshot - array['subject','text']::text[])='{}'::jsonb
  ),
  constraint communication_messages_state check (state in ('queued','submitted','delivered','failed','bounced')),
  constraint communication_messages_provider_id_check check (provider_message_id is null or length(provider_message_id) between 1 and 200),
  constraint communication_messages_submission_consistency check (
    (state in ('queued','failed') and provider_message_id is null)
    or (state in ('submitted','delivered','bounced') and submitted_at is not null and provider_message_id is not null)
  )
);
create index communication_messages_state_idx on public.communication_messages(organization_id,state,created_at);
create trigger set_communication_messages_updated_at before update on public.communication_messages
for each row execute function public.set_updated_at();

create table public.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  message_id uuid not null,
  job_type text not null default 'email.send',
  payload_version smallint not null default 1,
  business_idempotency_key text not null,
  provider_idempotency_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default clock_timestamp(),
  lease_owner text,
  lease_token uuid,
  lease_generation bigint not null default 0,
  lease_expires_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint outbox_jobs_message_fkey foreign key (organization_id,message_id)
    references public.communication_messages(organization_id,id) on delete cascade,
  constraint outbox_jobs_message_key unique(message_id),
  constraint outbox_jobs_business_key unique(organization_id,business_idempotency_key),
  constraint outbox_jobs_provider_idempotency_key unique(provider_idempotency_key),
  constraint outbox_jobs_job_type check(job_type='email.send'),
  constraint outbox_jobs_payload_version check(payload_version=1),
  constraint outbox_jobs_provider_key check(provider_idempotency_key ~ '^communication:[0-9a-f-]{36}$'),
  constraint outbox_jobs_status check(status in ('pending','leased','completed','dead_letter')),
  constraint outbox_jobs_attempts check(attempt_count between 0 and max_attempts and max_attempts between 1 and 20),
  constraint outbox_jobs_lease_generation check(lease_generation>=0),
  constraint outbox_jobs_lease_shape check(
    (status='leased' and lease_owner is not null and lease_token is not null and lease_expires_at is not null)
    or status<>'leased'
  ),
  constraint outbox_jobs_terminal_shape check(
    (status='completed' and completed_at is not null and dead_lettered_at is null)
    or (status='dead_letter' and dead_lettered_at is not null and completed_at is null)
    or (status in ('pending','leased') and completed_at is null and dead_lettered_at is null)
  ),
  constraint outbox_jobs_error_code check(last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{2,63}$')
);
create index outbox_jobs_claim_idx on public.outbox_jobs(available_at,created_at,id)
where status in ('pending','leased');
create trigger set_outbox_jobs_updated_at before update on public.outbox_jobs
for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
alter table public.communication_messages enable row level security;
alter table public.outbox_jobs enable row level security;
create policy notification_preferences_admin_read on public.notification_preferences for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy communication_messages_admin_read on public.communication_messages for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));

create type public.queue_communication_result as (outcome text,message_id uuid,job_id uuid);
create function public.queue_registration_communication(
  p_organization_id uuid,
  p_registration_id uuid,
  p_guardian_id uuid,
  p_message_kind text,
  p_notice_class text,
  p_subject text,
  p_text text,
  p_business_idempotency_key text
) returns public.queue_communication_result
language plpgsql security definer set search_path=''
as $$
declare
  recipient record;
  existing record;
  created_message uuid:=gen_random_uuid();
  created_job uuid:=gen_random_uuid();
  snapshot_recipient jsonb;
  snapshot_content jsonb;
  digest text;
  allowed boolean;
begin
  if auth.role()='service_role' then
    allowed:=true;
  else
    perform 1 from public.organization_members
      where organization_id=p_organization_id and user_id=auth.uid() for share;
    allowed:=auth.uid() is not null
      and public.is_active_organization_member(p_organization_id,array['owner','administrator']);
  end if;
  if not allowed then return ('forbidden'::text,null::uuid,null::uuid); end if;
  if p_notice_class not in ('operational','optional')
    or p_message_kind !~ '^[a-z][a-z0-9_]{2,63}$'
    or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
    or length(p_subject) not between 1 and 200
    or length(p_text) not between 1 and 20000
  then return ('invalid_input'::text,null::uuid,null::uuid); end if;

  select guardian.email::text as email,guardian.name,link.communication_permitted,
    coalesce(preference.optional_email_enabled,true) as optional_email_enabled
  into recipient
  from public.tryout_registrations registration
  join public.athlete_guardians link on link.organization_id=registration.organization_id
    and link.athlete_id=registration.athlete_id and link.guardian_id=p_guardian_id
  join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
  left join public.notification_preferences preference on preference.organization_id=guardian.organization_id and preference.guardian_id=guardian.id
  where registration.organization_id=p_organization_id and registration.id=p_registration_id;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  if p_notice_class='optional' and (not recipient.communication_permitted or not recipient.optional_email_enabled) then
    return ('suppressed'::text,null::uuid,null::uuid);
  end if;
  snapshot_recipient:=jsonb_build_object('email',lower(trim(recipient.email)),'name',recipient.name);
  snapshot_content:=jsonb_build_object('subject',p_subject,'text',p_text);
  digest:=encode(extensions.digest(convert_to(concat_ws(E'\n',p_registration_id::text,p_guardian_id::text,p_message_kind,p_notice_class,snapshot_recipient::text,snapshot_content::text),'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_business_idempotency_key,0));
  select id,request_digest into existing from public.communication_messages
  where organization_id=p_organization_id and business_idempotency_key=p_business_idempotency_key;
  if found then
    if existing.request_digest=digest then
      return ('replayed'::text,existing.id,(select id from public.outbox_jobs where message_id=existing.id));
    end if;
    return ('idempotency_conflict'::text,null::uuid,null::uuid);
  end if;

  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,request_digest,recipient_snapshot,content_snapshot)
  values(created_message,p_organization_id,'registration',p_registration_id,p_message_kind,p_notice_class,p_business_idempotency_key,digest,snapshot_recipient,snapshot_content);
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,p_organization_id,created_message,p_business_idempotency_key,'communication:'||created_message::text);
  return ('queued'::text,created_message,created_job);
end $$;

create type public.claimed_outbox_job as (
  job_id uuid,message_id uuid,lease_token uuid,lease_generation bigint,lease_expires_at timestamptz,
  provider_idempotency_key text,recipient_email text,subject text,body_text text,attempt_count integer,max_attempts integer
);

create function public.queue_roster_decision_communication(
  p_organization_id uuid,
  p_roster_version_id uuid,
  p_registration_id uuid,
  p_guardian_id uuid,
  p_expected_decision text,
  p_message_kind text,
  p_notice_class text,
  p_subject text,
  p_text text,
  p_business_idempotency_key text
) returns public.queue_communication_result
language plpgsql security definer set search_path=''
as $$
declare
  source record; existing record;
  created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  snapshot_recipient jsonb; snapshot_content jsonb; digest text; allowed boolean;
begin
  if p_expected_decision not in ('callback','selected','waitlisted','released')
    or p_notice_class not in ('operational','optional')
    or p_message_kind !~ '^[a-z][a-z0-9_]{2,63}$'
    or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
    or length(p_subject) not between 1 and 200 or length(p_text) not between 1 and 20000
  then return ('invalid_input'::text,null::uuid,null::uuid); end if;
  select decision.tryout_id,decision.division_id,guardian.email::text as email,guardian.name,
    link.communication_permitted,coalesce(preference.optional_email_enabled,true) as optional_email_enabled
  into source
  from public.roster_decisions decision
  join public.roster_versions version on version.organization_id=decision.organization_id
    and version.id=decision.roster_version_id and version.state='finalized'
  join public.tryout_registrations registration on registration.organization_id=decision.organization_id
    and registration.id=decision.registration_id
  join public.athlete_guardians link on link.organization_id=registration.organization_id
    and link.athlete_id=registration.athlete_id and link.guardian_id=p_guardian_id
  join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
  left join public.notification_preferences preference on preference.organization_id=guardian.organization_id and preference.guardian_id=guardian.id
  where decision.organization_id=p_organization_id and decision.roster_version_id=p_roster_version_id
    and decision.registration_id=p_registration_id and decision.status=p_expected_decision;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  allowed:=auth.role()='service_role' or (
    auth.uid() is not null and private.lock_and_can_manage_roster(p_organization_id,source.tryout_id,source.division_id)
  );
  if not allowed then return ('forbidden'::text,null::uuid,null::uuid); end if;
  if p_notice_class='optional' and (not source.communication_permitted or not source.optional_email_enabled) then
    return ('suppressed'::text,null::uuid,null::uuid);
  end if;
  snapshot_recipient:=jsonb_build_object('email',lower(trim(source.email)),'name',source.name);
  snapshot_content:=jsonb_build_object('subject',p_subject,'text',p_text);
  digest:=encode(extensions.digest(convert_to(concat_ws(E'\n',p_roster_version_id::text,p_registration_id::text,p_guardian_id::text,p_expected_decision,p_message_kind,p_notice_class,snapshot_recipient::text,snapshot_content::text),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_business_idempotency_key,0));
  select id,request_digest into existing from public.communication_messages
    where organization_id=p_organization_id and business_idempotency_key=p_business_idempotency_key;
  if found then
    if existing.request_digest=digest then return ('replayed'::text,existing.id,(select id from public.outbox_jobs where message_id=existing.id)); end if;
    return ('idempotency_conflict'::text,null::uuid,null::uuid);
  end if;
  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,request_digest,recipient_snapshot,content_snapshot)
  values(created_message,p_organization_id,'roster_decision',p_roster_version_id,p_message_kind,p_notice_class,p_business_idempotency_key,digest,snapshot_recipient,snapshot_content);
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,p_organization_id,created_message,p_business_idempotency_key,'communication:'||created_message::text);
  return ('queued'::text,created_message,created_job);
end $$;

create function public.queue_registration_confirmation_communication(
  p_registration_id uuid,p_guardian_email text,p_subject text,p_text text,p_business_idempotency_key text
) returns public.queue_communication_result
language plpgsql security definer set search_path=''
as $$
declare target record; result public.queue_communication_result;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select registration.organization_id,guardian.id as guardian_id into target
  from public.tryout_registrations registration
  join public.athlete_guardians link on link.organization_id=registration.organization_id and link.athlete_id=registration.athlete_id
  join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
  where registration.id=p_registration_id and guardian.normalized_email=public.normalize_registration_text(p_guardian_email)
  order by link.is_primary_contact desc,guardian.id limit 1;
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  select * into result from public.queue_registration_communication(
    target.organization_id,p_registration_id,target.guardian_id,'registration_confirmation','operational',
    p_subject,p_text,p_business_idempotency_key
  );
  return result;
end $$;

create function public.queue_invitation_communication(
  p_organization_id uuid,p_invitation_id uuid,p_subject text,p_text text,p_business_idempotency_key text
) returns public.queue_communication_result
language plpgsql security definer set search_path=''
as $$
declare invitation record; existing record;
  created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  snapshot_recipient jsonb; snapshot_content jsonb; digest text;
begin
  if auth.role()<>'service_role' then
    perform 1 from public.organization_members
      where organization_id=p_organization_id and user_id=auth.uid() for share;
  end if;
  if not (auth.role()='service_role' or (auth.uid() is not null and public.is_active_organization_member(p_organization_id,array['owner','administrator'])))
  then return ('forbidden'::text,null::uuid,null::uuid); end if;
  if length(p_subject) not between 1 and 200 or length(p_text) not between 1 and 20000
    or p_business_idempotency_key !~ '^[A-Za-z0-9:_-]{16,200}$'
  then return ('invalid_input'::text,null::uuid,null::uuid); end if;
  select email::text,role,expires_at into invitation from public.organization_invitations
    where organization_id=p_organization_id and id=p_invitation_id and accepted_at is null and revoked_at is null and expires_at>clock_timestamp();
  if not found then return ('forbidden'::text,null::uuid,null::uuid); end if;
  snapshot_recipient:=jsonb_build_object('email',lower(trim(invitation.email)),'name',null);
  snapshot_content:=jsonb_build_object('subject',p_subject,'text',p_text);
  digest:=encode(extensions.digest(convert_to(concat_ws(E'\n',p_invitation_id::text,invitation.role,invitation.expires_at::text,snapshot_recipient::text,snapshot_content::text),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_business_idempotency_key,0));
  select id,request_digest into existing from public.communication_messages where organization_id=p_organization_id and business_idempotency_key=p_business_idempotency_key;
  if found then
    if existing.request_digest=digest then return ('replayed'::text,existing.id,(select id from public.outbox_jobs where message_id=existing.id)); end if;
    return ('idempotency_conflict'::text,null::uuid,null::uuid);
  end if;
  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,request_digest,recipient_snapshot,content_snapshot)
  values(created_message,p_organization_id,'invitation',p_invitation_id,'member_invitation','operational',p_business_idempotency_key,digest,snapshot_recipient,snapshot_content);
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,p_organization_id,created_message,p_business_idempotency_key,'communication:'||created_message::text);
  return ('queued'::text,created_message,created_job);
end $$;

create function public.claim_outbox_jobs(p_lease_owner text,p_batch_size integer,p_lease_seconds integer)
returns setof public.claimed_outbox_job language plpgsql security definer set search_path=''
as $$
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lease_owner !~ '^[A-Za-z0-9:_-]{3,100}$' or p_batch_size not between 1 and 50 or p_lease_seconds not between 15 and 900 then
    raise exception 'invalid job claim' using errcode='22023';
  end if;
  with exhausted as (
    update public.outbox_jobs job set status='dead_letter',last_error_code='lease_attempts_exhausted',
      dead_lettered_at=clock_timestamp()
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp())
      and job.attempt_count>=job.max_attempts
    returning job.message_id
  )
  update public.communication_messages message set state='failed',attention_required_at=clock_timestamp()
  from exhausted where message.id=exhausted.message_id;
  return query
  with candidates as (
    select job.id from public.outbox_jobs job
    where job.status in ('pending','leased') and job.available_at<=clock_timestamp()
      and (job.status='pending' or job.lease_expires_at<=clock_timestamp())
      and job.attempt_count<job.max_attempts
    order by job.available_at,job.created_at,job.id
    for update skip locked limit p_batch_size
  ), claimed as (
    update public.outbox_jobs job set status='leased',attempt_count=job.attempt_count+1,
      lease_owner=p_lease_owner,lease_token=gen_random_uuid(),lease_generation=job.lease_generation+1,
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_error_code=null
    from candidates where job.id=candidates.id returning job.*
  )
  select claimed.id,claimed.message_id,claimed.lease_token,claimed.lease_generation,claimed.lease_expires_at,
    claimed.provider_idempotency_key,message.recipient_snapshot->>'email',message.content_snapshot->>'subject',
    message.content_snapshot->>'text',claimed.attempt_count,claimed.max_attempts
  from claimed join public.communication_messages message on message.id=claimed.message_id;
end $$;

create function public.complete_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_provider_message_id text)
returns text language plpgsql security definer set search_path=''
as $$
declare target public.outbox_jobs;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_provider_message_id is null or length(p_provider_message_id) not between 1 and 200 then return 'invalid_input'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation then return 'lease_conflict'; end if;
  if target.status='completed' then
    return case when (select provider_message_id from public.communication_messages where id=target.message_id)=p_provider_message_id then 'replayed' else 'terminal_conflict' end;
  end if;
  if target.status<>'leased' or target.lease_expires_at<=clock_timestamp() then return 'lease_conflict'; end if;
  update public.outbox_jobs set status='completed',completed_at=clock_timestamp() where id=p_job_id;
  update public.communication_messages set state='submitted',provider_message_id=p_provider_message_id,submitted_at=clock_timestamp() where id=target.message_id;
  return 'completed';
end $$;

create function public.fail_outbox_job(p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_error_code text,p_retryable boolean)
returns text language plpgsql security definer set search_path=''
as $$
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
    available_at=clock_timestamp()+make_interval(secs=>least(3600,
      30*(2::numeric^greatest(0,target.attempt_count-1))
      + ((hashtextextended(target.id::text||':'||target.lease_generation::text,0) & 1023) % 11)
    )::integer)
  where id=p_job_id;
  return 'retry_scheduled';
end $$;

revoke all on public.notification_preferences,public.communication_messages,public.outbox_jobs from public,anon,authenticated;
grant select on public.notification_preferences,public.communication_messages to authenticated;
grant select,insert,update,delete on public.notification_preferences,public.communication_messages,public.outbox_jobs to service_role;
revoke all on function public.queue_registration_communication(uuid,uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.queue_registration_communication(uuid,uuid,uuid,text,text,text,text,text) to authenticated,service_role;
revoke all on function public.queue_roster_decision_communication(uuid,uuid,uuid,uuid,text,text,text,text,text,text) from public,anon;
grant execute on function public.queue_roster_decision_communication(uuid,uuid,uuid,uuid,text,text,text,text,text,text) to authenticated,service_role;
revoke all on function public.queue_registration_confirmation_communication(uuid,text,text,text,text),public.queue_invitation_communication(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.queue_registration_confirmation_communication(uuid,text,text,text,text) to service_role;
grant execute on function public.queue_invitation_communication(uuid,uuid,text,text,text) to authenticated,service_role;
revoke all on function public.claim_outbox_jobs(text,integer,integer),public.complete_outbox_job(uuid,uuid,bigint,text),public.fail_outbox_job(uuid,uuid,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_outbox_jobs(text,integer,integer),public.complete_outbox_job(uuid,uuid,bigint,text),public.fail_outbox_job(uuid,uuid,bigint,text,boolean) to service_role;
