-- Task 23: exact finalized-roster message batches and authenticated provider evidence.

create table public.communication_templates (
  organization_id uuid not null,
  message_kind text not null,
  editable_text text not null,
  version bigint not null default 1,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,message_kind),
  constraint communication_templates_organization_fkey foreign key (organization_id)
    references public.organizations(id) on delete restrict,
  constraint communication_templates_actor_fkey foreign key (updated_by_user_id)
    references auth.users(id) on delete restrict,
  constraint communication_templates_kind_check check(message_kind in ('callback','selected','waitlisted','released')),
  constraint communication_templates_text_check check(char_length(trim(editable_text)) between 1 and 4000),
  constraint communication_templates_version_check check(version between 1 and 9007199254740991)
);
create trigger set_communication_templates_updated_at before update on public.communication_templates
for each row execute function public.set_updated_at();

create table public.communication_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  roster_version_id uuid not null,
  roster_version bigint not null,
  decision text not null,
  editable_text text not null,
  preview_digest text not null,
  recipient_count integer not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint communication_batches_org_id_key unique(organization_id,id),
  constraint communication_batches_organization_fkey foreign key (organization_id)
    references public.organizations(id) on delete restrict,
  constraint communication_batches_roster_fkey foreign key (organization_id,roster_version_id)
    references public.roster_versions(organization_id,id) on delete restrict,
  constraint communication_batches_actor_fkey foreign key (created_by_user_id)
    references auth.users(id) on delete restrict,
  constraint communication_batches_decision_check check(decision in ('callback','selected','waitlisted','released')),
  constraint communication_batches_text_check check(char_length(trim(editable_text)) between 1 and 4000),
  constraint communication_batches_digest_check check(preview_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_batches_count_check check(recipient_count between 1 and 500),
  constraint communication_batches_digest_key unique(organization_id,preview_digest)
);

alter table public.communication_messages
  add column communication_batch_id uuid,
  add column protected_facts_snapshot jsonb not null default '{}'::jsonb,
  add column delivery_state_at timestamptz;
alter table public.communication_messages add constraint communication_messages_batch_fkey
  foreign key (organization_id,communication_batch_id)
  references public.communication_batches(organization_id,id) on delete restrict;
alter table public.communication_messages add constraint communication_messages_protected_facts_shape check(
  communication_batch_id is null and protected_facts_snapshot='{}'::jsonb
  or communication_batch_id is not null
    and jsonb_typeof(protected_facts_snapshot)='object'
    and protected_facts_snapshot ?& array['organization_name','tryout_name','division_name',
      'athlete_preferred_name','decision','team_name','roster_version_id','roster_version',
      'recipient_registration_id','recipient_guardian_id','recipient_email','link_facts']
    and protected_facts_snapshot-array['organization_name','tryout_name','division_name',
      'athlete_preferred_name','decision','team_name','roster_version_id','roster_version',
      'recipient_registration_id','recipient_guardian_id','recipient_email','link_facts']='{}'::jsonb
    and jsonb_typeof(protected_facts_snapshot->'organization_name')='string'
    and jsonb_typeof(protected_facts_snapshot->'tryout_name')='string'
    and jsonb_typeof(protected_facts_snapshot->'division_name')='string'
    and jsonb_typeof(protected_facts_snapshot->'athlete_preferred_name')='string'
    and protected_facts_snapshot->>'decision' in ('callback','selected','waitlisted','released')
    and jsonb_typeof(protected_facts_snapshot->'roster_version_id')='string'
    and jsonb_typeof(protected_facts_snapshot->'roster_version')='number'
    and jsonb_typeof(protected_facts_snapshot->'recipient_registration_id')='string'
    and jsonb_typeof(protected_facts_snapshot->'recipient_guardian_id')='string'
    and jsonb_typeof(protected_facts_snapshot->'recipient_email')='string'
    and jsonb_typeof(protected_facts_snapshot->'link_facts')='object'
    and (protected_facts_snapshot->'link_facts')='{"is_primary_contact":true,
      "communication_permitted":true,"action_href":null,"action_label":null}'::jsonb
);

alter table public.communication_messages drop constraint communication_messages_content_shape;
alter table public.communication_messages add constraint communication_messages_content_shape check(
  jsonb_typeof(content_snapshot)='object'
  and content_snapshot ? 'subject' and content_snapshot ? 'text'
  and jsonb_typeof(content_snapshot->'subject')='string'
  and jsonb_typeof(content_snapshot->'text')='string'
  and length(content_snapshot->>'subject') between 1 and 200
  and length(content_snapshot->>'text') between 1 and 20000
  and (
    (content_snapshot-array['subject','text']::text[])='{}'::jsonb
    or (content_snapshot ? 'html' and jsonb_typeof(content_snapshot->'html')='string'
      and length(content_snapshot->>'html') between 1 and 30000
      and (content_snapshot-array['subject','text','html']::text[])='{}'::jsonb)
  )
);
alter table public.communication_messages drop constraint communication_messages_state;
alter table public.communication_messages add constraint communication_messages_state check(state in(
  'queued','delivery_uncertain','submitted','delivery_delayed','delivered','failed','bounced',
  'suppressed','complained','cancelled'
));
alter table public.communication_messages drop constraint communication_messages_submission_consistency;
alter table public.communication_messages add constraint communication_messages_submission_consistency check(
  (state in ('queued','cancelled') and provider_message_id is null)
  or (state in ('failed','suppressed') and (
    (provider_message_id is null and submitted_at is null)
    or (provider_message_id is not null and submitted_at is not null)))
  or (state='delivery_uncertain')
  or (state in ('submitted','delivery_delayed','delivered','bounced','complained')
    and submitted_at is not null and provider_message_id is not null)
);
alter table public.communication_messages drop constraint communication_messages_cancellation_reason;
alter table public.communication_messages add constraint communication_messages_cancellation_reason check(
  (state='cancelled' and cancellation_reason ~ '^[a-z][a-z0-9_]{2,63}$')
  or (state='suppressed' and (
    (provider_message_id is null and cancellation_reason ~ '^[a-z][a-z0-9_]{2,63}$')
    or (provider_message_id is not null and cancellation_reason is null)))
  or (state not in ('cancelled','suppressed') and cancellation_reason is null)
);
create unique index communication_messages_provider_message_key
  on public.communication_messages(provider_message_id) where provider_message_id is not null;

create table public.communication_delivery_events (
  event_id text primary key,
  organization_id uuid not null,
  message_id uuid not null,
  provider_message_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  applied_state text not null,
  constraint communication_delivery_events_message_fkey foreign key (organization_id,message_id)
    references public.communication_messages(organization_id,id) on delete restrict,
  constraint communication_delivery_events_id_check check(event_id ~ '^msg_[A-Za-z0-9_-]{8,200}$'),
  constraint communication_delivery_events_provider_check check(private.is_canonical_provider_message_id(provider_message_id)),
  constraint communication_delivery_events_type_check check(event_type in(
    'sent','delivery_delayed','delivered','failed','bounced','suppressed','complained')),
  constraint communication_delivery_events_state_check check(applied_state in(
    'submitted','delivery_delayed','delivered','failed','bounced','suppressed','complained'))
);
create index communication_delivery_events_message_idx
  on public.communication_delivery_events(organization_id,message_id,occurred_at,event_id);

-- A signed provider event resolves transport uncertainty, but it is not the
-- same evidence as a successful synchronous provider API response. Preserve
-- that distinction in the immutable attempt lineage.
alter table public.outbox_provider_handoffs
  drop constraint outbox_provider_handoffs_attempt_state,
  drop constraint outbox_provider_handoffs_resolution_shape;
alter table public.outbox_provider_handoffs
  add constraint outbox_provider_handoffs_attempt_state check(
    attempt_state in ('authorized','declined','provider_failed','completed','delivery_uncertain','event_confirmed')
  ),
  add constraint outbox_provider_handoffs_resolution_shape check(
    (attempt_state='authorized' and resolved_at is null and provider_message_id is null)
    or (attempt_state in ('declined','provider_failed','delivery_uncertain') and resolved_at is not null and provider_message_id is null)
    or (attempt_state in ('completed','event_confirmed') and resolved_at is not null and provider_message_id is not null)
  );

create or replace function private.guard_outbox_handoff_insert() returns trigger
language plpgsql set search_path='' as $$
declare target public.outbox_jobs%rowtype; message public.communication_messages%rowtype;
begin
  if tg_op='UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.job_id is distinct from old.job_id or new.message_id is distinct from old.message_id
      or new.lease_token is distinct from old.lease_token
      or new.lease_generation is distinct from old.lease_generation
      or new.provider_idempotency_key is distinct from old.provider_idempotency_key
      or new.send_attempt_token is distinct from old.send_attempt_token
      or new.started_at is distinct from old.started_at
    then raise exception 'provider attempt lineage is append-only' using errcode='55000'; end if;
    if old.attempt_state='authorized' and new.attempt_state<>'authorized' then return new; end if;
    select * into target from public.outbox_jobs where id=old.job_id;
    select * into message from public.communication_messages where id=old.message_id;
    if old.attempt_state='delivery_uncertain' and new.attempt_state='completed'
      and target.status='completed' and message.state='submitted'
      and new.provider_message_id=message.provider_message_id
      and new.resolved_at=target.completed_at
      and old.lease_token=target.lease_token and old.lease_generation=target.lease_generation
      and old.started_at=target.provider_submission_started_at
      and old.provider_idempotency_key=target.provider_idempotency_key
    then return new; end if;
    if old.attempt_state='delivery_uncertain' and new.attempt_state='event_confirmed'
      and target.status='completed' and message.provider_message_id=new.provider_message_id
      and exists(select 1 from public.communication_delivery_events event
        where event.organization_id=old.organization_id and event.message_id=old.message_id
          and event.provider_message_id=new.provider_message_id)
      and old.provider_idempotency_key=target.provider_idempotency_key
    then return new; end if;
    if old.attempt_state='completed' and new.attempt_state='delivery_uncertain'
      and target.status='needs_attention'
      and target.delivery_uncertain_reason='legacy_completed_lineage_invalid'
      and new.provider_message_id is null
    then return new; end if;
    raise exception 'provider attempt lineage is append-only' using errcode='55000';
  end if;
  select * into target from public.outbox_jobs where id=new.job_id;
  if not found or target.organization_id<>new.organization_id or target.message_id<>new.message_id
    or target.provider_idempotency_key<>new.provider_idempotency_key
    or target.lease_token is distinct from new.lease_token
    or target.lease_generation<>new.lease_generation
    or target.lease_expires_at is null or new.started_at>target.lease_expires_at
    or new.started_at>clock_timestamp()
  then raise exception 'invalid provider attempt lineage' using errcode='23514'; end if;
  return new;
end $$;

create function private.delivery_precedence(p_state text) returns integer
language sql immutable parallel safe set search_path='' as $$
  select case p_state when 'queued' then 0 when 'delivery_uncertain' then 1
    when 'submitted' then 2 when 'sent' then 2 when 'delivery_delayed' then 3
    when 'delivered' then 4 when 'failed' then 5 when 'bounced' then 6
    when 'suppressed' then 7 when 'complained' then 8 else -1 end
$$;

create function public.apply_resend_delivery_event(
  p_event_id text,p_message_id uuid,p_provider_message_id text,p_event_type text,p_occurred_at timestamptz
) returns text language plpgsql security definer set search_path='' as $$
declare target public.communication_messages%rowtype; next_state text; applied text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_event_id !~ '^msg_[A-Za-z0-9_-]{8,200}$'
    or not private.is_canonical_provider_message_id(p_provider_message_id)
    or p_event_type not in ('sent','delivery_delayed','delivered','failed','bounced','suppressed','complained')
    or p_occurred_at is null or p_occurred_at>clock_timestamp()+interval '5 minutes'
    or p_occurred_at<clock_timestamp()-interval '1 year'
  then return 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended('resend-event:'||p_event_id,0));
  perform pg_advisory_xact_lock(hashtextextended('resend-provider:'||p_provider_message_id,0));
  select * into target from public.communication_messages where id=p_message_id for update;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.communication_delivery_events where event_id=p_event_id) then
    return case when exists(select 1 from public.communication_delivery_events
      where event_id=p_event_id and message_id=p_message_id and provider_message_id=p_provider_message_id
        and event_type=p_event_type and occurred_at=p_occurred_at) then 'replayed' else 'event_conflict' end;
  end if;
  if target.provider_message_id is not null and target.provider_message_id<>p_provider_message_id
    then return 'provider_conflict'; end if;
  if exists(select 1 from public.communication_messages existing
    where existing.provider_message_id=p_provider_message_id and existing.id<>target.id)
    then return 'provider_conflict'; end if;
  if target.state not in ('delivery_uncertain','submitted','delivery_delayed','delivered','failed','bounced','suppressed','complained')
    then return 'state_conflict'; end if;
  next_state:=case p_event_type when 'sent' then 'submitted' else p_event_type end;
  applied:=case when private.delivery_precedence(next_state)>private.delivery_precedence(target.state)
    then next_state else target.state end;
  update public.communication_messages set state=applied,
    provider_message_id=coalesce(provider_message_id,p_provider_message_id),
    submitted_at=coalesce(submitted_at,p_occurred_at),
    delivery_state_at=greatest(coalesce(delivery_state_at,'-infinity'::timestamptz),p_occurred_at),
    attention_required_at=case
      when applied in ('failed','bounced','suppressed','complained')
        then coalesce(attention_required_at,clock_timestamp())
      when applied='delivery_uncertain' then attention_required_at else null end
  where id=target.id;
  insert into public.communication_delivery_events(event_id,organization_id,message_id,
    provider_message_id,event_type,occurred_at,applied_state)
  values(p_event_id,target.organization_id,target.id,p_provider_message_id,p_event_type,p_occurred_at,applied);
  if target.state='delivery_uncertain' then
    update public.outbox_jobs set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),
      delivery_uncertain_at=null,delivery_uncertain_reason=null,last_error_code=null,
      lease_owner=null,lease_token=null,lease_expires_at=null
    where message_id=target.id and status='needs_attention';
    update public.outbox_provider_handoffs set attempt_state='event_confirmed',
      resolved_at=clock_timestamp(),provider_message_id=p_provider_message_id
    where job_id in(select id from public.outbox_jobs where message_id=target.id and status='completed')
      and attempt_state='delivery_uncertain';
  end if;
  return applied;
end $$;

create type public.decision_message_batch_result as(
  outcome text,batch_id uuid,queued_count integer
);

create function private.escape_message_html(p_value text) returns text
language sql immutable parallel safe set search_path='' as $$
  select replace(replace(replace(replace(replace(p_value,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')
$$;

create function private.safe_message_header(p_value text) returns text
language sql immutable parallel safe set search_path='' as $$
  select trim(replace(replace(replace(replace(p_value,E'\r',' '),E'\n',' '),chr(8232),' '),chr(8233),' '))
$$;

create function public.preview_decision_message_batch(
  p_organization_id uuid,p_roster_version_id uuid,p_decision text,p_editable_text text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; recipient_rows jsonb; recipient_lineage jsonb;
  recipient_count integer; preview_digest text;
begin
  if auth.uid() is null or p_decision not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000
  then return jsonb_build_object('outcome','invalid_input'); end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id
    and id=p_roster_version_id;
  if not found or not private.can_user_authorize_roster_notice(auth.uid(),p_organization_id,roster.tryout_id,roster.division_id)
    then return jsonb_build_object('outcome','forbidden'); end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id
    and id=p_roster_version_id for share;
  if not found then return jsonb_build_object('outcome','forbidden'); end if;
  if roster.state<>'finalized' or exists(select 1 from public.roster_versions newer
    where newer.organization_id=roster.organization_id and newer.tryout_id=roster.tryout_id
      and newer.division_id=roster.division_id and newer.state='finalized'
      and newer.revision_number>roster.revision_number)
  then return jsonb_build_object('outcome','stale_snapshot'); end if;
  select jsonb_agg(jsonb_build_object('registrationId',registration_id,
      'recipientEmail',lower(trim(email)),'athletePreferredName',athlete_name) order by registration_id),
    jsonb_agg(jsonb_build_object(
      'registration_id',registration_id,'guardian_id',guardian_id,'email',lower(trim(email)),
      'athlete_name',athlete_name,'organization_name',organization_name,'tryout_name',tryout_name,
      'division_name',division_name,'team_name',team_name,
      'link_facts',jsonb_build_object('is_primary_contact',true,'communication_permitted',true,
        'action_href',null,'action_label',null)) order by registration_id),
    count(*) into recipient_rows,recipient_lineage,recipient_count
  from (
    select decision.registration_id,link.guardian_id,guardian.email::text email,
      trim(athlete.given_name) athlete_name,organization.name organization_name,
      tryout.name tryout_name,division.name division_name,team.name team_name
    from public.roster_decisions decision
    join public.roster_versions version on version.organization_id=decision.organization_id
      and version.id=decision.roster_version_id
    join public.organizations organization on organization.id=decision.organization_id
    join public.tryouts tryout on tryout.organization_id=version.organization_id and tryout.id=version.tryout_id
    join public.tryout_divisions division on division.organization_id=version.organization_id and division.id=version.division_id
    join public.tryout_registrations registration on registration.organization_id=decision.organization_id
      and registration.id=decision.registration_id and registration.status='submitted'
    join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
    join public.athlete_guardians link on link.organization_id=registration.organization_id
      and link.athlete_id=registration.athlete_id and link.is_primary_contact and link.communication_permitted
    join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
    left join public.roster_assignments assignment on assignment.organization_id=decision.organization_id
      and assignment.roster_version_id=decision.roster_version_id and assignment.registration_id=decision.registration_id
    left join public.tryout_teams team on team.organization_id=assignment.organization_id and team.id=assignment.team_id
    where decision.organization_id=p_organization_id and decision.roster_version_id=p_roster_version_id
      and decision.status=p_decision
  ) recipients;
  if recipient_count not between 1 and 500 then return jsonb_build_object('outcome','invalid_input'); end if;
  preview_digest:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'roster_version_id',p_roster_version_id,
    'roster_version',roster.version,'decision',p_decision,'editable_text',trim(p_editable_text),
    'recipients',recipient_lineage)::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object('outcome','ok','organizationId',p_organization_id,
    'rosterVersionId',p_roster_version_id,'rosterVersion',roster.version,'kind',p_decision,
    'editableText',trim(p_editable_text),'recipients',recipient_rows,'count',recipient_count,
    'digest',preview_digest);
end $$;

create function public.create_decision_message_batch(
  p_organization_id uuid,p_roster_version_id uuid,p_expected_version bigint,p_decision text,
  p_editable_text text,p_preview_digest text,p_expected_recipient_ids uuid[],p_confirmation text
) returns public.decision_message_batch_result language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; source record; computed_digest text;
  batch_id uuid:=gen_random_uuid(); message_id uuid; job_id uuid; queued_count integer:=0;
  existing_batch_id uuid; existing_count integer; recipient_ids uuid[];
  source_rows jsonb; subject_text text; body_text text; body_html text; facts jsonb;
begin
  if auth.uid() is null or p_confirmation<>'SEND EXACT BATCH'
    or p_decision not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000
    or p_preview_digest !~ '^[0-9a-f]{64}$'
    or coalesce(cardinality(p_expected_recipient_ids),0) not between 1 and 500
  then return ('invalid_input'::text,null::uuid,0)::public.decision_message_batch_result; end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id
    and id=p_roster_version_id;
  if not found or not private.can_user_authorize_roster_notice(auth.uid(),p_organization_id,roster.tryout_id,roster.division_id)
    then return ('forbidden'::text,null::uuid,0)::public.decision_message_batch_result; end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id
    and id=p_roster_version_id for update;
  if not found then return ('forbidden'::text,null::uuid,0)::public.decision_message_batch_result; end if;
  if roster.state<>'finalized' or roster.version<>p_expected_version
    or exists(select 1 from public.roster_versions newer
      where newer.organization_id=roster.organization_id and newer.tryout_id=roster.tryout_id
        and newer.division_id=roster.division_id and newer.state='finalized'
        and newer.revision_number>roster.revision_number) then
    return ('stale_snapshot'::text,null::uuid,0)::public.decision_message_batch_result; end if;
  select array_agg(registration_id order by registration_id),
    jsonb_agg(jsonb_build_object(
      'registration_id',registration_id,'guardian_id',guardian_id,'email',lower(trim(email)),
      'athlete_name',athlete_name,'organization_name',organization_name,'tryout_name',tryout_name,
      'division_name',division_name,'team_name',team_name,
      'link_facts',jsonb_build_object('is_primary_contact',true,'communication_permitted',true,
        'action_href',null,'action_label',null)) order by registration_id)
  into recipient_ids,source_rows
  from (
    select decision.registration_id,link.guardian_id,guardian.email::text email,
      trim(athlete.given_name) athlete_name,organization.name organization_name,
      tryout.name tryout_name,division.name division_name,team.name team_name
    from public.roster_decisions decision
    join public.roster_versions version on version.organization_id=decision.organization_id
      and version.id=decision.roster_version_id
    join public.organizations organization on organization.id=decision.organization_id
    join public.tryouts tryout on tryout.organization_id=version.organization_id and tryout.id=version.tryout_id
    join public.tryout_divisions division on division.organization_id=version.organization_id and division.id=version.division_id
    join public.tryout_registrations registration on registration.organization_id=decision.organization_id
      and registration.id=decision.registration_id and registration.status='submitted'
    join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
    join public.athlete_guardians link on link.organization_id=registration.organization_id
      and link.athlete_id=registration.athlete_id and link.is_primary_contact and link.communication_permitted
    join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
    left join public.roster_assignments assignment on assignment.organization_id=decision.organization_id
      and assignment.roster_version_id=decision.roster_version_id and assignment.registration_id=decision.registration_id
    left join public.tryout_teams team on team.organization_id=assignment.organization_id and team.id=assignment.team_id
    where decision.organization_id=p_organization_id and decision.roster_version_id=p_roster_version_id
      and decision.status=p_decision
  ) recipients;
  computed_digest:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'roster_version_id',p_roster_version_id,
    'roster_version',roster.version,'decision',p_decision,'editable_text',trim(p_editable_text),
    'recipients',source_rows)::text,'UTF8'),'sha256'),'hex');
  if recipient_ids is null or recipient_ids<>p_expected_recipient_ids or computed_digest<>p_preview_digest
    then return ('preview_conflict'::text,null::uuid,0)::public.decision_message_batch_result; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_preview_digest,0));
  select id,recipient_count into existing_batch_id,existing_count from public.communication_batches
    where organization_id=p_organization_id and preview_digest=p_preview_digest;
  if found then return ('replayed'::text,existing_batch_id,existing_count)::public.decision_message_batch_result; end if;
  insert into public.communication_batches(id,organization_id,roster_version_id,roster_version,
    decision,editable_text,preview_digest,recipient_count,created_by_user_id)
  values(batch_id,p_organization_id,p_roster_version_id,roster.version,p_decision,trim(p_editable_text),
    p_preview_digest,cardinality(recipient_ids),auth.uid());
  for source in select
    (value->>'registration_id')::uuid registration_id,(value->>'guardian_id')::uuid guardian_id,
    value->>'email' email,value->>'athlete_name' athlete_name,
    value->>'organization_name' organization_name,value->>'tryout_name' tryout_name,
    value->>'division_name' division_name,value->>'team_name' team_name
    from jsonb_array_elements(source_rows) rows(value)
  loop
    message_id:=gen_random_uuid(); job_id:=gen_random_uuid();
    subject_text:=case p_decision when 'callback' then 'Callback invitation' when 'selected' then 'Roster selection'
      when 'waitlisted' then 'Waitlist update' else 'Tryout decision' end||': '||
      private.safe_message_header(source.tryout_name);
    body_text:=source.organization_name||E'\n'||source.tryout_name||E'\nDivision: '||source.division_name||
      E'\nAthlete: '||source.athlete_name||E'\nThe finalized decision is: '||initcap(p_decision)||'.'||
      case when source.team_name is null then '' else E'\nTeam: '||source.team_name end||E'\n\n'||trim(p_editable_text)||
      E'\n\nRoster snapshot: '||p_roster_version_id||' (version '||roster.version||')';
    body_html:='<main><p><strong>'||private.escape_message_html(source.organization_name)||'</strong><br>'||
      private.escape_message_html(source.tryout_name)||'<br>Division: '||private.escape_message_html(source.division_name)||
      '<br>Athlete: '||private.escape_message_html(source.athlete_name)||'</p><p><strong>The finalized decision is: '||
      initcap(p_decision)||'.</strong>'||case when source.team_name is null then '' else '<br>Team: '||private.escape_message_html(source.team_name) end||
      '</p><section aria-label="Organization message"><p>'||replace(private.escape_message_html(trim(p_editable_text)),E'\n','<br>')||
      '</p></section><footer>Roster snapshot: '||p_roster_version_id||' (version '||roster.version||')</footer></main>';
    facts:=jsonb_build_object('organization_name',source.organization_name,'tryout_name',source.tryout_name,
      'division_name',source.division_name,'athlete_preferred_name',source.athlete_name,'decision',p_decision,
      'team_name',source.team_name,'roster_version_id',p_roster_version_id,'roster_version',roster.version,
      'recipient_registration_id',source.registration_id,'recipient_guardian_id',source.guardian_id,
      'recipient_email',source.email,'link_facts',jsonb_build_object('is_primary_contact',true,
        'communication_permitted',true,'action_href',null,'action_label',null));
    insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
      business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
      source_registration_id,source_guardian_id,source_roster_version_id,source_expected_decision,
      source_authorizing_user_id,communication_batch_id,protected_facts_snapshot)
    values(message_id,p_organization_id,'roster_decision',p_roster_version_id,'roster_decision_notice','operational',
      'decision-batch:'||batch_id||':'||source.registration_id,
      encode(extensions.digest(convert_to(p_preview_digest||':'||source.registration_id,'UTF8'),'sha256'),'hex'),
      jsonb_build_object('email',source.email),jsonb_build_object('subject',subject_text,'text',body_text,'html',body_html),
      1,source.registration_id,source.guardian_id,p_roster_version_id,p_decision,auth.uid(),batch_id,facts);
    insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
    values(job_id,p_organization_id,message_id,'decision-batch:'||batch_id||':'||source.registration_id,
      'communication:'||message_id);
    queued_count:=queued_count+1;
  end loop;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'communication.batch_created','communication_batch',batch_id,
    jsonb_build_object('decision',p_decision,'recipient_count',queued_count,'roster_version_id',p_roster_version_id));
  return ('queued'::text,batch_id,queued_count)::public.decision_message_batch_result;
end $$;

-- Add HTML to the worker projection without exposing another table surface.
alter type public.claimed_outbox_job add attribute body_html text;
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
      message.content_snapshot->>'text',leased.attempt_count,leased.max_attempts,message.content_snapshot->>'html');
    return next result;
    if handled_count>=p_batch_size then return; end if;
  end loop;
end $$;

alter table public.communication_templates enable row level security;
alter table public.communication_batches enable row level security;
alter table public.communication_delivery_events enable row level security;
create policy communication_templates_admin_read on public.communication_templates for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy communication_batches_admin_read on public.communication_batches for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy communication_batches_roster_read on public.communication_batches for select to authenticated
using(exists(select 1 from public.roster_versions version
  where version.organization_id=public.communication_batches.organization_id
  and version.id=public.communication_batches.roster_version_id
  and private.can_read_roster(version.organization_id,version.tryout_id,version.division_id,true)));
create policy communication_delivery_events_admin_read on public.communication_delivery_events for select to authenticated
using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy communication_delivery_events_roster_read on public.communication_delivery_events for select to authenticated
using(exists(select 1 from public.communication_messages message
  join public.roster_versions version on version.organization_id=message.organization_id
    and version.id=message.source_roster_version_id
  where message.organization_id=public.communication_delivery_events.organization_id
    and message.id=public.communication_delivery_events.message_id
    and private.can_read_roster(version.organization_id,version.tryout_id,version.division_id,true)));
create policy communication_messages_roster_read on public.communication_messages for select to authenticated
using(source_kind='roster_decision' and exists(select 1 from public.roster_versions version
  where version.organization_id=public.communication_messages.organization_id
    and version.id=public.communication_messages.source_roster_version_id
    and private.can_read_roster(version.organization_id,version.tryout_id,version.division_id,true)));

revoke all on public.communication_templates,public.communication_batches,public.communication_delivery_events
from public,anon,authenticated,service_role;
grant select on public.communication_templates,public.communication_batches,public.communication_delivery_events to authenticated;
revoke all on function private.delivery_precedence(text),private.escape_message_html(text),private.safe_message_header(text) from public,anon,authenticated,service_role;
revoke all on function public.apply_resend_delivery_event(text,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_resend_delivery_event(text,uuid,text,text,timestamptz) to service_role;
revoke all on function public.create_decision_message_batch(uuid,uuid,bigint,text,text,text,uuid[],text) from public,anon;
grant execute on function public.create_decision_message_batch(uuid,uuid,bigint,text,text,text,uuid[],text) to authenticated;
revoke all on function public.preview_decision_message_batch(uuid,uuid,text,text) from public,anon;
grant execute on function public.preview_decision_message_batch(uuid,uuid,text,text) to authenticated;

create function private.prevent_communication_evidence_mutation() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'communication evidence is append-only' using errcode='55000'; end $$;
create trigger prevent_communication_batches_mutation before update or delete on public.communication_batches
for each row execute function private.prevent_communication_evidence_mutation();
create trigger prevent_communication_delivery_events_mutation before update or delete on public.communication_delivery_events
for each row execute function private.prevent_communication_evidence_mutation();
alter table public.communication_batches enable always trigger prevent_communication_batches_mutation;
alter table public.communication_delivery_events enable always trigger prevent_communication_delivery_events_mutation;
create trigger deny_communication_batches_truncate before truncate on public.communication_batches
for each statement execute function private.deny_communication_truncate();
create trigger deny_communication_delivery_events_truncate before truncate on public.communication_delivery_events
for each statement execute function private.deny_communication_truncate();
alter table public.communication_batches enable always trigger deny_communication_batches_truncate;
alter table public.communication_delivery_events enable always trigger deny_communication_delivery_events_truncate;
revoke all on function private.prevent_communication_evidence_mutation() from public,anon,authenticated,service_role;
