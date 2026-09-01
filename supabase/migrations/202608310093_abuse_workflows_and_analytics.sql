-- Shared abuse controls, missing staff registration/cycle workflows, and a
-- privacy-closed durable analytics sink.

create table private.abuse_rate_limits(
  subject_digest text not null,
  address_digest text not null,
  scope text not null,
  attempts integer not null,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  primary key(subject_digest,address_digest,scope),
  constraint abuse_rate_limits_subject_digest_check check(subject_digest~'^[0-9a-f]{64}$'),
  constraint abuse_rate_limits_address_digest_check check(address_digest~'^[0-9a-f]{64}$'),
  constraint abuse_rate_limits_scope_check check(scope in(
    'auth_sign_in','auth_sign_up','auth_recovery','auth_verification',
    'public_registration','registration_confirmation','registration_reissue'
  )),
  constraint abuse_rate_limits_attempts_check check(attempts between 1 and 101),
  constraint abuse_rate_limits_window_check check(expires_at>window_started_at)
);
alter table private.abuse_rate_limits enable row level security;

create table private.bot_token_receipts(
  token_digest text not null,
  action text not null,
  consumed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  primary key(token_digest,action),
  constraint bot_token_receipts_digest_check check(token_digest~'^[0-9a-f]{64}$'),
  constraint bot_token_receipts_action_check check(action in(
    'sign_in','sign_up','recovery','verification','public_registration',
    'registration_confirmation','registration_reissue'
  )),
  constraint bot_token_receipts_expiry_check check(expires_at>consumed_at)
);
alter table private.bot_token_receipts enable row level security;

create or replace function public.consume_abuse_rate_limit(
  p_subject_digest text,
  p_address_digest text,
  p_scope text,
  p_limit integer,
  p_window_seconds integer
) returns table(allowed boolean,remaining integer,retry_after_seconds integer)
language plpgsql security definer set search_path=''
as $$
declare
  counter private.abuse_rate_limits%rowtype;
  now_at timestamptz:=clock_timestamp();
begin
  if p_subject_digest!~'^[0-9a-f]{64}$' or p_address_digest!~'^[0-9a-f]{64}$'
    or p_scope not in('auth_sign_in','auth_sign_up','auth_recovery','auth_verification',
      'public_registration','registration_confirmation','registration_reissue')
    or p_limit not between 1 and 100 or p_window_seconds not between 10 and 3600
  then raise invalid_parameter_value using message='invalid abuse rate-limit request'; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','abuse',p_scope,p_subject_digest,p_address_digest),0));
  select * into counter from private.abuse_rate_limits item
    where item.subject_digest=p_subject_digest and item.address_digest=p_address_digest and item.scope=p_scope
    for update;
  if not found or counter.expires_at<=now_at then
    insert into private.abuse_rate_limits(subject_digest,address_digest,scope,attempts,window_started_at,expires_at)
    values(p_subject_digest,p_address_digest,p_scope,1,now_at,now_at+make_interval(secs=>p_window_seconds))
    on conflict(subject_digest,address_digest,scope) do update
      set attempts=1,window_started_at=excluded.window_started_at,expires_at=excluded.expires_at
    returning * into counter;
  else
    update private.abuse_rate_limits item set attempts=least(item.attempts+1,101)
      where item.subject_digest=p_subject_digest and item.address_digest=p_address_digest and item.scope=p_scope
      returning * into counter;
  end if;
  return query select counter.attempts<=p_limit,greatest(p_limit-counter.attempts,0),
    greatest(1,ceil(extract(epoch from counter.expires_at-now_at))::integer);
end;
$$;

create or replace function public.consume_bot_token_once(
  p_token_digest text,
  p_action text,
  p_ttl_seconds integer
) returns table(consumed boolean)
language plpgsql security definer set search_path=''
as $$
declare now_at timestamptz:=clock_timestamp();
begin
  if p_token_digest!~'^[0-9a-f]{64}$'
    or p_action not in('sign_in','sign_up','recovery','verification','public_registration','registration_confirmation','registration_reissue')
    or p_ttl_seconds not between 30 and 300
  then raise invalid_parameter_value using message='invalid bot-token receipt request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','bot-token',p_action,p_token_digest),0));
  delete from private.bot_token_receipts receipt
    where receipt.token_digest=p_token_digest and receipt.action=p_action and receipt.expires_at<=now_at;
  insert into private.bot_token_receipts(token_digest,action,expires_at)
  values(p_token_digest,p_action,now_at+make_interval(secs=>p_ttl_seconds))
  on conflict do nothing;
  return query select found;
end;
$$;

create table public.analytics_outbox_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_name text not null,
  workflow text not null,
  correlation_id text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint analytics_outbox_event_name_check check(event_name in('workflow.started','workflow.completed','workflow.failed')),
  constraint analytics_outbox_workflow_check check(workflow in(
    'onboarding','tryout_setup','registration','checkin','evaluation_sync','roster',
    'communication','integration_export','report_export','billing'
  )),
  constraint analytics_outbox_correlation_check check(correlation_id~'^[A-Za-z0-9_-]{1,80}$'),
  constraint analytics_outbox_empty_payload_check check(payload='{}'::jsonb),
  constraint analytics_outbox_idempotency_key unique(organization_id,event_name,workflow,correlation_id)
);
alter table public.analytics_outbox_events enable row level security;

create or replace function public.prevent_analytics_outbox_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise object_not_in_prerequisite_state using message='analytics outbox evidence is append-only'; end;
$$;
create trigger prevent_analytics_outbox_mutation
before update or delete on public.analytics_outbox_events
for each row execute function public.prevent_analytics_outbox_mutation();

create or replace function public.enqueue_analytics_event(
  p_organization_id uuid,
  p_event_name text,
  p_workflow text,
  p_correlation_id text
) returns table(outcome text,event_id uuid)
language plpgsql security definer set search_path=''
as $$
declare created_id uuid;
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id) then
    raise insufficient_privilege using message='forbidden';
  end if;
  if p_event_name not in('workflow.started','workflow.completed','workflow.failed')
    or p_workflow not in('onboarding','tryout_setup','registration','checkin','evaluation_sync','roster',
      'communication','integration_export','report_export','billing')
    or p_correlation_id!~'^[A-Za-z0-9_-]{1,80}$'
  then raise invalid_parameter_value using message='invalid analytics event'; end if;
  insert into public.analytics_outbox_events(organization_id,event_name,workflow,correlation_id)
  values(p_organization_id,p_event_name,p_workflow,p_correlation_id)
  on conflict(organization_id,event_name,workflow,correlation_id) do nothing
  returning id into created_id;
  if created_id is null then
    select id into created_id from public.analytics_outbox_events item
      where item.organization_id=p_organization_id and item.event_name=p_event_name
        and item.workflow=p_workflow and item.correlation_id=p_correlation_id;
    return query select 'replayed'::text,created_id; return;
  end if;
  return query select 'queued'::text,created_id;
end;
$$;

create or replace function public.create_tryout_draft_with_cycle(
  p_organization_id uuid,
  p_season_id uuid,
  p_new_season_name text,
  p_name text,
  p_slug text,
  p_sport text,
  p_timezone text,
  p_registration_starts_at timestamptz,
  p_registration_ends_at timestamptz
) returns table(
  tryout_id uuid,organization_id uuid,season_id uuid,season_name text,name text,slug text,
  sport text,timezone text,status text,registration_starts_at timestamptz,
  registration_ends_at timestamptz,published_at timestamptz,finalized_at timestamptz,
  version integer,created_at timestamptz,updated_at timestamptz
)
language plpgsql security definer set search_path=''
as $$
declare
  selected_season public.seasons%rowtype;
  created_tryout public.tryouts%rowtype;
  normalized_season text:=trim(coalesce(p_new_season_name,''));
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
    raise insufficient_privilege using message='forbidden';
  end if;
  if (p_season_id is null)=(normalized_season='')
    or char_length(normalized_season)>120
    or char_length(trim(coalesce(p_name,''))) not between 1 and 160
  then raise invalid_parameter_value using message='select exactly one cycle'; end if;
  if p_season_id is not null then
    select * into selected_season from public.seasons item
      where item.organization_id=p_organization_id and item.id=p_season_id for share;
    if not found then raise invalid_parameter_value using message='invalid cycle'; end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','season',p_organization_id,lower(normalized_season)),0));
    select * into selected_season from public.seasons item
      where item.organization_id=p_organization_id and lower(item.name)=lower(normalized_season) for update;
    if not found then
      insert into public.seasons(organization_id,name) values(p_organization_id,normalized_season)
      returning * into selected_season;
    end if;
  end if;
  insert into public.tryouts(
    organization_id,season_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at
  ) values(
    p_organization_id,selected_season.id,trim(p_name),p_slug,trim(p_sport),p_timezone,
    p_registration_starts_at,p_registration_ends_at
  ) returning * into created_tryout;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'tryout.created','tryout',created_tryout.id,
    jsonb_build_object('seasonId',selected_season.id));
  return query select created_tryout.id,created_tryout.organization_id,created_tryout.season_id,
    selected_season.name,created_tryout.name,created_tryout.slug,created_tryout.sport,
    created_tryout.timezone,created_tryout.status,created_tryout.registration_starts_at,
    created_tryout.registration_ends_at,created_tryout.published_at,created_tryout.finalized_at,
    created_tryout.version,created_tryout.created_at,created_tryout.updated_at;
end;
$$;

create or replace function public.list_returning_athletes(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_query text,
  p_limit integer default 20
) returns table(athlete_id uuid,given_name text,family_name text,birth_date date,prior_registrations bigint)
language plpgsql stable security definer set search_path=''
as $$
declare normalized_query text:=public.normalize_registration_text(coalesce(p_query,''));
begin
  if auth.uid() is null or not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise insufficient_privilege using message='forbidden';
  end if;
  if char_length(normalized_query) not between 2 and 80 or p_limit not between 1 and 25 then
    raise invalid_parameter_value using message='invalid athlete lookup';
  end if;
  return query
  select athlete.id,athlete.given_name,athlete.family_name,athlete.birth_date,
    count(registration.id)::bigint
  from public.athletes athlete
  left join public.tryout_registrations registration
    on registration.organization_id=athlete.organization_id and registration.athlete_id=athlete.id
  where athlete.organization_id=p_organization_id
    and public.normalize_registration_text(athlete.given_name||' '||athlete.family_name) like '%'||normalized_query||'%'
  group by athlete.id
  order by athlete.family_name,athlete.given_name,athlete.id
  limit p_limit;
end;
$$;

create or replace function public.load_staff_registration_configuration(
  p_organization_id uuid,
  p_tryout_id uuid
) returns table(
  tryout_name text,
  tryout_status text,
  divisions jsonb,
  positions jsonb,
  form_schema jsonb
)
language plpgsql stable security definer set search_path=''
as $$
declare target public.tryouts%rowtype; selected_schema jsonb;
begin
  if auth.uid() is null or not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise insufficient_privilege using message='forbidden';
  end if;
  select * into target from public.tryouts item
    where item.organization_id=p_organization_id and item.id=p_tryout_id;
  if not found then return; end if;
  select version.schema into selected_schema
  from public.tryout_registration_form_selections selection
  join public.registration_form_versions version
    on version.organization_id=selection.organization_id
      and version.tryout_id=selection.tryout_id
      and version.id=selection.registration_form_version_id
  where selection.organization_id=p_organization_id and selection.tryout_id=p_tryout_id;
  return query select target.name,target.status,
    coalesce((select jsonb_agg(jsonb_build_object('id',division.id,'name',division.name)
      order by division.sort_order,division.id) from public.tryout_divisions division
      where division.organization_id=p_organization_id and division.tryout_id=p_tryout_id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id',position.id,'name',position.name)
      order by position.sort_order,position.id) from public.tryout_positions position
      where position.organization_id=p_organization_id and position.tryout_id=p_tryout_id),'[]'::jsonb),
    coalesce(selected_schema,'{"fields":[]}'::jsonb);
end;
$$;

create or replace function public.create_staff_registration(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_existing_athlete_id uuid,
  p_division_id uuid,
  p_position_id uuid,
  p_given_name text,
  p_family_name text,
  p_birth_date date,
  p_responses jsonb,
  p_submission_key_digest text
) returns table(outcome text,registration_id uuid,athlete_id uuid)
language plpgsql security definer set search_path=''
as $$
declare
  target public.tryouts%rowtype;
  athlete public.athletes%rowtype;
  version public.registration_form_versions%rowtype;
  created_registration public.tryout_registrations%rowtype;
  field jsonb;
  answer jsonb;
  content_digest text;
begin
  if auth.uid() is null or not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise insufficient_privilege using message='forbidden';
  end if;
  if p_submission_key_digest!~'^[0-9a-f]{64}$' or jsonb_typeof(p_responses)<>'object' then
    raise invalid_parameter_value using message='invalid staff registration';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','staff-registration',p_organization_id,p_tryout_id,p_submission_key_digest),0));
  select * into created_registration from public.tryout_registrations item
    where item.organization_id=p_organization_id and item.tryout_id=p_tryout_id
      and item.submission_key_digest=p_submission_key_digest;
  if found then return query select 'replayed'::text,created_registration.id,created_registration.athlete_id; return; end if;

  select * into target from public.tryouts item
    where item.organization_id=p_organization_id and item.id=p_tryout_id and item.status in('draft','published') for share;
  if not found then return query select 'not_found'::text,null::uuid,null::uuid; return; end if;
  if not exists(select 1 from public.tryout_divisions division
      where division.organization_id=p_organization_id and division.tryout_id=p_tryout_id and division.id=p_division_id)
    or (p_position_id is not null and not exists(select 1 from public.tryout_positions position
      where position.organization_id=p_organization_id and position.tryout_id=p_tryout_id and position.id=p_position_id))
  then raise invalid_parameter_value using message='invalid registration placement'; end if;
  select form_version.* into version
  from public.tryout_registration_form_selections selection
  join public.registration_form_versions form_version
    on form_version.organization_id=selection.organization_id and form_version.tryout_id=selection.tryout_id
      and form_version.id=selection.registration_form_version_id
  where selection.organization_id=p_organization_id and selection.tryout_id=p_tryout_id
    and form_version.status in('draft','published') for share of selection,form_version;
  if not found then return query select 'form_missing'::text,null::uuid,null::uuid; return; end if;
  if exists(select 1 from jsonb_object_keys(p_responses) response_key
      where not exists(select 1 from jsonb_array_elements(version.schema->'fields') item where item->>'key'=response_key))
  then raise invalid_parameter_value using message='unknown registration response'; end if;
  for field in select value from jsonb_array_elements(version.schema->'fields') loop
    answer:=p_responses->(field->>'key');
    if (field->>'required')::boolean and (answer is null or answer='null'::jsonb or answer='""'::jsonb)
      then raise invalid_parameter_value using message='required registration response missing'; end if;
  end loop;
  if p_existing_athlete_id is not null then
    select * into athlete from public.athletes item
      where item.organization_id=p_organization_id and item.id=p_existing_athlete_id for share;
    if not found then return query select 'athlete_not_found'::text,null::uuid,null::uuid; return; end if;
  else
    if char_length(trim(coalesce(p_given_name,''))) not between 1 and 120
      or char_length(trim(coalesce(p_family_name,''))) not between 1 and 120
      or p_birth_date is null or p_birth_date>current_date
    then raise invalid_parameter_value using message='invalid athlete identity'; end if;
    insert into public.athletes(
      organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
    ) values(
      p_organization_id,trim(p_given_name),trim(p_family_name),
      public.normalize_registration_text(p_given_name),public.normalize_registration_text(p_family_name),p_birth_date
    ) returning * into athlete;
  end if;
  content_digest:=encode(extensions.digest(convert_to(jsonb_build_object(
    'athleteId',athlete.id,'divisionId',p_division_id,'positionId',p_position_id,
    'formVersionId',version.id,'responses',p_responses
  )::text,'UTF8'),'sha256'),'hex');
  insert into public.tryout_registrations(
    organization_id,tryout_id,athlete_id,division_id,position_id,registration_form_version_id,
    responses,source,submission_key_digest,submission_digest,submission_digest_version
  ) values(
    p_organization_id,p_tryout_id,athlete.id,p_division_id,p_position_id,version.id,
    p_responses,'staff',p_submission_key_digest,content_digest,2
  ) returning * into created_registration;
  insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id)
    select p_organization_id,p_tryout_id,created_registration.id,session.id
    from public.tryout_sessions session
    where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id
      and session.division_id=p_division_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'registration.staff_created','tryout_registration',created_registration.id,
    jsonb_build_object('athleteId',athlete.id,'tryoutId',p_tryout_id,'returningAthlete',p_existing_athlete_id is not null));
  return query select 'created'::text,created_registration.id,athlete.id;
end;
$$;

create or replace function public.issue_checkin_qr_token(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid
) returns text language plpgsql security definer set search_path='' as $$
declare raw text; registration public.tryout_registrations%rowtype;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id)
    or not exists(select 1 from public.tryouts item where item.organization_id=p_organization_id
      and item.id=p_tryout_id and item.status in('published','finalized'))
  then return null; end if;
  select * into registration from public.tryout_registrations item
    where item.organization_id=p_organization_id and item.tryout_id=p_tryout_id and item.id=p_registration_id for update;
  if registration.id is null or registration.status<>'submitted' then return null; end if;
  raw:=encode(extensions.gen_random_bytes(32),'hex');
  update public.checkin_qr_tokens set revoked_at=clock_timestamp()
    where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id
      and used_at is null and revoked_at is null;
  insert into public.checkin_qr_tokens(organization_id,tryout_id,registration_id,token_digest,expires_at)
  values(p_organization_id,p_tryout_id,p_registration_id,encode(extensions.digest(raw,'sha256'),'hex'),clock_timestamp()+interval '24 hours');
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'checkin.qr_issued','tryout_registration',p_registration_id,
    jsonb_build_object('expiresInHours',24));
  return raw;
end;
$$;

revoke all on table private.abuse_rate_limits,private.bot_token_receipts from public,anon,authenticated,service_role;
revoke all on table public.analytics_outbox_events from public,anon,authenticated,service_role;
revoke all on function public.consume_abuse_rate_limit(text,text,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.consume_bot_token_once(text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_analytics_event(uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.create_tryout_draft_with_cycle(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.list_returning_athletes(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.load_staff_registration_configuration(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_staff_registration(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.consume_abuse_rate_limit(text,text,text,integer,integer) to service_role;
grant execute on function public.consume_bot_token_once(text,text,integer) to service_role;
grant execute on function public.enqueue_analytics_event(uuid,text,text,text) to authenticated;
grant execute on function public.create_tryout_draft_with_cycle(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.list_returning_athletes(uuid,uuid,text,integer) to authenticated;
grant execute on function public.load_staff_registration_configuration(uuid,uuid) to authenticated;
grant execute on function public.create_staff_registration(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text) to authenticated;
