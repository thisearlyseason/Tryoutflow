-- Organizer destinations never enter the published registration form schema.
create table private.registration_notification_settings (
  organization_id uuid not null,
  tryout_id uuid not null,
  notification_email text,
  updated_by_user_id uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,tryout_id),
  foreign key (organization_id,tryout_id) references public.tryouts(organization_id,id) on delete cascade,
  constraint registration_notification_email_check check (notification_email is null or (
    length(notification_email) between 3 and 254
    and notification_email=lower(btrim(notification_email))
    and notification_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and notification_email !~ '[[:cntrl:]]'
  ))
);
alter table private.registration_notification_settings enable row level security;
revoke all on private.registration_notification_settings from public,anon,authenticated,service_role;

create function public.get_registration_notification_settings(p_organization_id uuid,p_tryout_id uuid)
returns table(notification_email text)
language plpgsql security definer set search_path='' as $$
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query select settings.notification_email
  from private.registration_notification_settings settings
  where settings.organization_id=p_organization_id and settings.tryout_id=p_tryout_id;
end $$;

create function public.save_registration_form_configuration(
  p_organization_id uuid,p_tryout_id uuid,p_payload jsonb
) returns table(outcome text)
language plpgsql security definer set search_path='' as $$
declare destination text; saved_outcome text;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    return query select 'invalid_input'::text; return;
  end if;
  destination:=nullif(lower(btrim(p_payload->>'notificationEmail')),'');
  if p_payload ? 'notificationEmail' and (
    jsonb_typeof(p_payload->'notificationEmail') not in ('string','null')
    or (destination is not null and (length(destination)>254
      or destination !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or destination ~ '[[:cntrl:]]'))
  ) then return query select 'invalid_input'::text; return; end if;
  select saved.outcome into saved_outcome from public.save_tryout_wizard_configuration(
    p_organization_id,p_tryout_id,'registration',p_payload-'notificationEmail'
  ) saved;
  if saved_outcome='saved' and p_payload ? 'notificationEmail' then
    insert into private.registration_notification_settings(organization_id,tryout_id,notification_email,updated_by_user_id)
    values(p_organization_id,p_tryout_id,destination,auth.uid())
    on conflict(organization_id,tryout_id) do update set notification_email=excluded.notification_email,
      updated_by_user_id=excluded.updated_by_user_id,updated_at=clock_timestamp();
  end if;
  return query select saved_outcome;
end $$;

-- Keep all existing source contracts while adding a disjoint organizer source.
alter table public.communication_messages drop constraint communication_messages_source_kind;
alter table public.communication_messages add constraint communication_messages_source_kind
  check(source_kind in ('registration','roster_decision','invitation','organizer_registration'));
do $$
declare constraint_name text; existing_expression text;
begin
  foreach constraint_name in array array['communication_messages_source_binding','communication_messages_server_owned_kind'] loop
    select pg_get_expr(conbin,conrelid) into existing_expression from pg_constraint
    where conrelid='public.communication_messages'::regclass and conname=constraint_name;
    execute format('alter table public.communication_messages drop constraint %I',constraint_name);
    execute format('alter table public.communication_messages add constraint %I check ((%s) or (
      source_kind=''organizer_registration'' and source_binding_version=1
      and message_kind=''organizer_registration_received'' and notice_class=''operational''
      and source_registration_id is not null and source_registration_id=source_id
      and source_guardian_id is null and source_roster_version_id is null
      and source_expected_decision is null and source_confirmation_token_digest is null
      and source_invitation_token_digest is null and source_authorizing_user_id is not null
    ))',constraint_name,existing_expression);
  end loop;
end $$;

-- The existing worker still validates and leases every job. Recheck the manager,
-- submitted registration and destination immediately before provider handoff.
alter function private.lock_communication_source_reason(uuid) rename to lock_communication_source_reason_v107;
create function private.lock_communication_source_reason(p_message_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare message public.communication_messages%rowtype; source record;
begin
  select * into message from public.communication_messages where id=p_message_id for update;
  if not found then return 'message_not_queued'; end if;
  if message.source_kind<>'organizer_registration' then
    return private.lock_communication_source_reason_v107(p_message_id);
  end if;
  if message.state<>'queued' then return 'message_not_queued'; end if;
  if message.source_binding_version<>1 then return 'source_unverifiable'; end if;
  perform 1 from public.organizations where id=message.organization_id and status='active' for share;
  if not found then return 'organization_inactive'; end if;
  select registration.tryout_id,registration.status,settings.notification_email
  into source from public.tryout_registrations registration
  join private.registration_notification_settings settings on settings.organization_id=registration.organization_id
    and settings.tryout_id=registration.tryout_id
  where registration.organization_id=message.organization_id and registration.id=message.source_registration_id
  for share of registration,settings;
  if not found or source.status<>'submitted' then return 'registration_ineligible'; end if;
  if source.notification_email is null or source.notification_email is distinct from message.recipient_snapshot->>'email'
    then return 'recipient_changed'; end if;
  if not private.can_user_authorize_roster_notice(message.source_authorizing_user_id,message.organization_id,source.tryout_id,null)
    then return 'authorizer_offboarded'; end if;
  return null;
end $$;

create function public.queue_organizer_registration_notification(p_registration_id uuid,p_app_origin text)
returns public.queue_communication_result
language plpgsql security definer set search_path='' as $$
declare source record; existing record; created_message uuid:=gen_random_uuid(); created_job uuid:=gen_random_uuid();
  business_key text:='organizer-registration:'||p_registration_id::text;
  recipient jsonb; content jsonb; digest text;
begin
  if auth.role() is distinct from 'service_role' then return ('forbidden'::text,null::uuid,null::uuid); end if;
  -- Only an origin is accepted; no caller-controlled message or recipient content.
  if p_registration_id is null or p_app_origin is null or length(p_app_origin)>300
    or (p_app_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
      and p_app_origin !~ '^http://(localhost|127[.]0[.]0[.]1):3112$')
    then return ('invalid_input'::text,null::uuid,null::uuid); end if;
  select registration.organization_id,registration.tryout_id,organization.slug,
    settings.notification_email,settings.updated_by_user_id
  into source from public.tryout_registrations registration
  join public.organizations organization on organization.id=registration.organization_id and organization.status='active'
  join private.registration_notification_settings settings on settings.organization_id=registration.organization_id
    and settings.tryout_id=registration.tryout_id
  where registration.id=p_registration_id and registration.status='submitted'
  for share of registration,organization,settings;
  if not found then return ('suppressed'::text,null::uuid,null::uuid); end if;
  perform pg_advisory_xact_lock(hashtextextended(source.organization_id::text||':'||business_key,0));
  select message.id,job.id job_id into existing from public.communication_messages message
  join public.outbox_jobs job on job.message_id=message.id
  where message.organization_id=source.organization_id and message.business_idempotency_key=business_key;
  if found then return ('replayed'::text,existing.id,existing.job_id); end if;
  if source.notification_email is null then return ('suppressed'::text,null::uuid,null::uuid); end if;
  if not private.can_user_authorize_roster_notice(source.updated_by_user_id,source.organization_id,source.tryout_id,null)
    then return ('forbidden'::text,null::uuid,null::uuid); end if;
  recipient:=jsonb_build_object('email',source.notification_email);
  content:=jsonb_build_object('subject','New tryout registration','text',
    'A new registration has been submitted. Sign in to TryoutFlow to review it: '||p_app_origin||
    '/app/'||source.slug||'/tryouts/'||source.tryout_id::text||'/registration');
  digest:=encode(extensions.digest(convert_to(business_key||recipient::text||content::text,'UTF8'),'sha256'),'hex');
  insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
    business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
    source_registration_id,source_authorizing_user_id)
  values(created_message,source.organization_id,'organizer_registration',p_registration_id,'organizer_registration_received',
    'operational',business_key,digest,recipient,content,1,p_registration_id,source.updated_by_user_id);
  insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
  values(created_job,source.organization_id,created_message,business_key,'communication:'||created_message::text);
  return ('queued'::text,created_message,created_job);
end $$;

revoke all on function public.get_registration_notification_settings(uuid,uuid),
  public.save_registration_form_configuration(uuid,uuid,jsonb),
  public.queue_organizer_registration_notification(uuid,text),
  private.lock_communication_source_reason(uuid),private.lock_communication_source_reason_v107(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_registration_notification_settings(uuid,uuid),
  public.save_registration_form_configuration(uuid,uuid,jsonb) to authenticated;
grant execute on function public.queue_organizer_registration_notification(uuid,text) to service_role;

-- Builder reads follow the explicit selection; newer unselected drafts are not active.
create function public.get_registration_form_configuration(p_organization_id uuid,p_tryout_id uuid)
returns table(form_name text,form_schema jsonb,registration_form_version_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query select form.name,version.schema,version.id
  from public.tryout_registration_form_selections selection
  join public.registration_form_versions version on version.organization_id=selection.organization_id
    and version.tryout_id=selection.tryout_id and version.id=selection.registration_form_version_id
  join public.registration_forms form on form.organization_id=version.organization_id
    and form.tryout_id=version.tryout_id and form.id=version.registration_form_id
  where selection.organization_id=p_organization_id and selection.tryout_id=p_tryout_id;
end $$;
revoke all on function public.get_registration_form_configuration(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_registration_form_configuration(uuid,uuid) to authenticated;
