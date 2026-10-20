-- Task 23 review hardening: authoritative rendering, one-use previews, and pending callbacks.

create table public.communication_preview_proofs (
  token_digest text primary key,
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  roster_version_id uuid not null,
  roster_version bigint not null,
  decision text not null,
  editable_text text not null,
  render_digest text not null,
  recipient_digest text not null,
  payload_snapshot jsonb not null,
  actor_user_id uuid not null,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  communication_batch_id uuid,
  constraint communication_preview_proofs_token_check check(token_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_preview_proofs_decision_check check(decision in ('callback','selected','waitlisted','released')),
  constraint communication_preview_proofs_render_check check(render_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_preview_proofs_recipient_check check(recipient_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_preview_proofs_time_check check(expires_at>issued_at and expires_at<=issued_at+interval '15 minutes'),
  constraint communication_preview_proofs_consume_check check((consumed_at is null)=(communication_batch_id is null)),
  constraint communication_preview_proofs_org_fkey foreign key(organization_id) references public.organizations(id) on delete restrict,
  constraint communication_preview_proofs_roster_fkey foreign key(organization_id,roster_version_id) references public.roster_versions(organization_id,id) on delete restrict,
  constraint communication_preview_proofs_actor_fkey foreign key(actor_user_id) references auth.users(id) on delete restrict,
  constraint communication_preview_proofs_batch_fkey foreign key(organization_id,communication_batch_id) references public.communication_batches(organization_id,id) on delete restrict
);

create table public.communication_pending_delivery_events (
  event_id text primary key,
  message_id uuid not null,
  provider_message_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  constraint communication_pending_events_id_check check(event_id ~ '^msg_[A-Za-z0-9_-]{8,200}$'),
  constraint communication_pending_events_provider_check check(private.is_canonical_provider_message_id(provider_message_id)),
  constraint communication_pending_events_type_check check(event_type in('sent','delivery_delayed','delivered','failed','bounced','suppressed','complained'))
);

alter table public.communication_messages
  add column source_tryout_id uuid,
  add column source_division_id uuid;
alter table public.communication_messages add constraint communication_messages_source_tryout_fkey
  foreign key(organization_id,source_tryout_id) references public.tryouts(organization_id,id) on delete restrict not valid;
alter table public.communication_messages add constraint communication_messages_source_division_fkey
  foreign key(organization_id,source_tryout_id,source_division_id)
  references public.tryout_divisions(organization_id,tryout_id,id) on delete restrict not valid;
alter table public.communication_messages add constraint communication_messages_batch_source_scope check(
  communication_batch_id is null or source_tryout_id is not null and source_division_id is not null
) not valid;

create function private.render_decision_message_payload(
  p_organization_id uuid,p_roster_version_id uuid,p_decision text,p_editable_text text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; rows jsonb; count_rows integer;
begin
  select * into roster from public.roster_versions where organization_id=p_organization_id and id=p_roster_version_id for share;
  if not found then return jsonb_build_object('outcome','forbidden'); end if;
  if roster.state<>'finalized' or exists(select 1 from public.roster_versions newer
    where newer.organization_id=roster.organization_id and newer.tryout_id=roster.tryout_id
      and newer.division_id=roster.division_id and newer.state='finalized'
      and newer.revision_number>roster.revision_number)
  then return jsonb_build_object('outcome','stale_snapshot'); end if;
  select jsonb_agg(jsonb_build_object(
    'registration_id',registration_id,'guardian_id',guardian_id,'recipient_email',email,
    'athlete_preferred_name',athlete_name,'organization_name',organization_name,
    'tryout_name',tryout_name,'division_name',division_name,'team_name',team_name,
    'subject',subject_text,'text',body_text,'html',body_html,
    'link_facts',jsonb_build_object('is_primary_contact',true,'communication_permitted',true,
      'action_href',null,'action_label',null)) order by registration_id),count(*) into rows,count_rows
  from (
    select base.*,
      (case p_decision when 'callback' then 'Callback invitation' when 'selected' then 'Roster selection'
        when 'waitlisted' then 'Waitlist update' else 'Tryout decision' end)||': '||private.safe_message_header(tryout_name) subject_text,
      organization_name||E'\n'||tryout_name||E'\nDivision: '||division_name||E'\nAthlete: '||athlete_name||
        E'\nThe finalized decision is: '||initcap(p_decision)||'.'||
        case when team_name is null then '' else E'\nTeam: '||team_name end||E'\n\n'||trim(p_editable_text)||
        E'\n\nRoster snapshot: '||p_roster_version_id||' (version '||roster.version||')' body_text,
      '<main><p><strong>'||private.escape_message_html(organization_name)||'</strong><br>'||
        private.escape_message_html(tryout_name)||'<br>Division: '||private.escape_message_html(division_name)||
        '<br>Athlete: '||private.escape_message_html(athlete_name)||'</p><p><strong>The finalized decision is: '||
        initcap(p_decision)||'.</strong>'||case when team_name is null then '' else '<br>Team: '||private.escape_message_html(team_name) end||
        '</p><section aria-label="Organization message"><p>'||replace(private.escape_message_html(trim(p_editable_text)),E'\n','<br>')||
        '</p></section><footer>Roster snapshot: '||p_roster_version_id||' (version '||roster.version||')</footer></main>' body_html
    from (
      select decision.registration_id,link.guardian_id,lower(trim(guardian.email::text)) email,
        trim(athlete.given_name) athlete_name,organization.name organization_name,
        tryout.name tryout_name,division.name division_name,team.name team_name
      from public.roster_decisions decision
      join public.roster_versions version on version.organization_id=decision.organization_id and version.id=decision.roster_version_id
      join public.organizations organization on organization.id=decision.organization_id and organization.status='active'
      join public.tryouts tryout on tryout.organization_id=version.organization_id and tryout.id=version.tryout_id
      join public.tryout_divisions division on division.organization_id=version.organization_id and division.id=version.division_id
      join public.tryout_registrations registration on registration.organization_id=decision.organization_id
        and registration.id=decision.registration_id and registration.tryout_id=version.tryout_id
        and registration.division_id=version.division_id and registration.status='submitted'
      join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
      join public.athlete_guardians link on link.organization_id=registration.organization_id
        and link.athlete_id=registration.athlete_id and link.is_primary_contact and link.communication_permitted
      join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
      left join public.roster_assignments assignment on assignment.organization_id=decision.organization_id
        and assignment.roster_version_id=decision.roster_version_id and assignment.registration_id=decision.registration_id
      left join public.tryout_teams team on team.organization_id=assignment.organization_id and team.id=assignment.team_id
      where decision.organization_id=p_organization_id and decision.roster_version_id=p_roster_version_id
        and decision.status=p_decision
    ) base
  ) rendered;
  if count_rows not between 1 and 500 then return jsonb_build_object('outcome','invalid_input'); end if;
  return jsonb_build_object('outcome','ok','organization_id',p_organization_id,'tryout_id',roster.tryout_id,
    'division_id',roster.division_id,'roster_version_id',p_roster_version_id,'roster_version',roster.version,
    'decision',p_decision,'editable_text',trim(p_editable_text),'rows',rows,'count',count_rows);
end $$;

create or replace function public.preview_decision_message_batch(
  p_organization_id uuid,p_roster_version_id uuid,p_decision text,p_editable_text text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; payload jsonb; render_digest text; recipient_digest text;
  token text:=encode(extensions.gen_random_bytes(32),'hex'); issued timestamptz:=clock_timestamp();
begin
  if auth.uid() is null or p_decision not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000
  then return jsonb_build_object('outcome','invalid_input'); end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id and id=p_roster_version_id;
  if not found or not private.can_user_authorize_roster_notice(auth.uid(),p_organization_id,roster.tryout_id,roster.division_id)
    then return jsonb_build_object('outcome','forbidden'); end if;
  payload:=private.render_decision_message_payload(p_organization_id,p_roster_version_id,p_decision,p_editable_text);
  if payload->>'outcome'<>'ok' then return payload; end if;
  render_digest:=encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');
  recipient_digest:=encode(extensions.digest(convert_to((select jsonb_agg(jsonb_build_object(
    'registration_id',r->>'registration_id','guardian_id',r->>'guardian_id','recipient_email',r->>'recipient_email')
    order by r->>'registration_id') from jsonb_array_elements(payload->'rows') r)::text,'UTF8'),'sha256'),'hex');
  insert into public.communication_preview_proofs(token_digest,organization_id,tryout_id,division_id,
    roster_version_id,roster_version,decision,editable_text,render_digest,recipient_digest,payload_snapshot,
    actor_user_id,issued_at,expires_at)
  values(encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),p_organization_id,
    (payload->>'tryout_id')::uuid,(payload->>'division_id')::uuid,p_roster_version_id,
    (payload->>'roster_version')::bigint,p_decision,trim(p_editable_text),render_digest,recipient_digest,
    payload,auth.uid(),issued,issued+interval '10 minutes');
  return jsonb_build_object('outcome','ok','organizationId',p_organization_id,
    'tryoutId',payload->>'tryout_id','divisionId',payload->>'division_id',
    'rosterVersionId',p_roster_version_id,'rosterVersion',(payload->>'roster_version')::bigint,
    'kind',p_decision,'editableText',trim(p_editable_text),'count',(payload->>'count')::integer,
    'digest',render_digest,'recipientDigest',recipient_digest,'previewToken',token,
    'issuedAt',issued,'expiresAt',issued+interval '10 minutes','recipients',
    (select jsonb_agg(jsonb_build_object('registrationId',r->>'registration_id',
      'recipientEmail',r->>'recipient_email','athletePreferredName',r->>'athlete_preferred_name',
      'subject',r->>'subject','text',r->>'text','html',r->>'html') order by r->>'registration_id')
     from jsonb_array_elements(payload->'rows') r));
end $$;

create function public.create_decision_message_batch_v2(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_preview_token text,p_preview_digest text,p_confirmation text
) returns public.decision_message_batch_result language plpgsql security definer set search_path='' as $$
declare proof public.communication_preview_proofs%rowtype; current_payload jsonb; current_digest text;
  existing public.communication_batches%rowtype; new_batch uuid:=gen_random_uuid(); row jsonb;
  message_id uuid; job_id uuid; queued integer:=0; facts jsonb;
begin
  if auth.uid() is null or p_confirmation<>'SEND EXACT BATCH' or p_preview_token !~ '^[0-9a-f]{64}$'
    or p_preview_digest !~ '^[0-9a-f]{64}$'
  then return ('invalid_input',null,0)::public.decision_message_batch_result; end if;
  select * into proof from public.communication_preview_proofs
    where token_digest=encode(extensions.digest(convert_to(p_preview_token,'UTF8'),'sha256'),'hex') for update;
  if not found or proof.organization_id<>p_organization_id or proof.tryout_id<>p_tryout_id
    or proof.division_id<>p_division_id or proof.roster_version_id<>p_roster_version_id
    or proof.actor_user_id<>auth.uid()
    then return ('forbidden',null,0)::public.decision_message_batch_result; end if;
  if proof.consumed_at is not null then
    return case when proof.render_digest=p_preview_digest
      then ('replayed',proof.communication_batch_id,(select recipient_count from public.communication_batches where id=proof.communication_batch_id))::public.decision_message_batch_result
      else ('preview_conflict',null,0)::public.decision_message_batch_result end;
  end if;
  if proof.expires_at<=clock_timestamp() then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  if proof.render_digest<>p_preview_digest or not private.can_user_authorize_roster_notice(auth.uid(),proof.organization_id,proof.tryout_id,proof.division_id)
    then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  perform 1 from public.roster_versions where organization_id=proof.organization_id and id=proof.roster_version_id for update;
  current_payload:=private.render_decision_message_payload(proof.organization_id,proof.roster_version_id,proof.decision,proof.editable_text);
  current_digest:=encode(extensions.digest(convert_to(current_payload::text,'UTF8'),'sha256'),'hex');
  if current_payload->>'outcome'<>'ok' or current_digest<>proof.render_digest or current_payload<>proof.payload_snapshot
    then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  select * into existing from public.communication_batches where organization_id=proof.organization_id and preview_digest=proof.render_digest;
  if found then
    update public.communication_preview_proofs set consumed_at=clock_timestamp(),communication_batch_id=existing.id where token_digest=proof.token_digest;
    return ('replayed',existing.id,existing.recipient_count)::public.decision_message_batch_result;
  end if;
  insert into public.communication_batches(id,organization_id,roster_version_id,roster_version,decision,
    editable_text,preview_digest,recipient_count,created_by_user_id)
  values(new_batch,proof.organization_id,proof.roster_version_id,proof.roster_version,proof.decision,
    proof.editable_text,proof.render_digest,(current_payload->>'count')::integer,auth.uid());
  for row in select value from jsonb_array_elements(current_payload->'rows') rows(value) loop
    message_id:=gen_random_uuid(); job_id:=gen_random_uuid();
    facts:=jsonb_build_object('organization_name',row->>'organization_name','tryout_name',row->>'tryout_name',
      'division_name',row->>'division_name','athlete_preferred_name',row->>'athlete_preferred_name',
      'decision',proof.decision,'team_name',row->'team_name','roster_version_id',proof.roster_version_id,
      'roster_version',proof.roster_version,'recipient_registration_id',row->>'registration_id',
      'recipient_guardian_id',row->>'guardian_id','recipient_email',row->>'recipient_email','link_facts',row->'link_facts');
    insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
      business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
      source_registration_id,source_guardian_id,source_roster_version_id,source_expected_decision,
      source_authorizing_user_id,communication_batch_id,protected_facts_snapshot,source_tryout_id,source_division_id)
    values(message_id,proof.organization_id,'roster_decision',proof.roster_version_id,'roster_decision_notice','operational',
      'decision-batch:'||new_batch||':'||(row->>'registration_id'),
      encode(extensions.digest(convert_to(proof.render_digest||':'||(row->>'registration_id'),'UTF8'),'sha256'),'hex'),
      jsonb_build_object('email',row->>'recipient_email'),jsonb_build_object('subject',row->>'subject','text',row->>'text','html',row->>'html'),
      1,(row->>'registration_id')::uuid,(row->>'guardian_id')::uuid,proof.roster_version_id,proof.decision,
      auth.uid(),new_batch,facts,proof.tryout_id,proof.division_id);
    insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
    values(job_id,proof.organization_id,message_id,'decision-batch:'||new_batch||':'||(row->>'registration_id'),'communication:'||message_id);
    queued:=queued+1;
  end loop;
  update public.communication_preview_proofs set consumed_at=clock_timestamp(),communication_batch_id=new_batch where token_digest=proof.token_digest;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(proof.organization_id,auth.uid(),'communication.batch_created','communication_batch',new_batch,
    jsonb_build_object('decision',proof.decision,'recipient_count',queued,'roster_version_id',proof.roster_version_id));
  return ('queued',new_batch,queued)::public.decision_message_batch_result;
end $$;

create function public.save_communication_template(
  p_organization_id uuid,p_message_kind text,p_editable_text text,p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.communication_templates%rowtype; next_version bigint;
begin
  if auth.uid() is null or p_message_kind not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000 or p_expected_version not between 0 and 9007199254740990
    then return jsonb_build_object('outcome','invalid_input'); end if;
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    then return jsonb_build_object('outcome','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended('communication-template:'||p_organization_id::text||':'||p_message_kind,0));
  select * into existing from public.communication_templates where organization_id=p_organization_id and message_kind=p_message_kind for update;
  if found and existing.version<>p_expected_version then return jsonb_build_object('outcome','version_conflict','version',existing.version); end if;
  if not found and p_expected_version<>0 then return jsonb_build_object('outcome','version_conflict','version',0); end if;
  next_version:=p_expected_version+1;
  insert into public.communication_templates(organization_id,message_kind,editable_text,version,updated_by_user_id)
  values(p_organization_id,p_message_kind,trim(p_editable_text),next_version,auth.uid())
  on conflict(organization_id,message_kind) do update set editable_text=excluded.editable_text,
    version=excluded.version,updated_by_user_id=excluded.updated_by_user_id;
  return jsonb_build_object('outcome','saved','version',next_version,'editableText',trim(p_editable_text));
end $$;

-- Operational roster notices require the exact primary/permitted link at execution time.
create or replace function private.lock_communication_source_reason(p_message_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare message public.communication_messages%rowtype; source record;
begin
  select * into message from public.communication_messages where id=p_message_id for update;
  if not found or message.state<>'queued' then return 'message_not_queued'; end if;
  if message.source_binding_version<>1 then return 'source_unverifiable'; end if;
  perform 1 from public.organizations where id=message.organization_id and status='active' for share;
  if not found then return 'organization_inactive'; end if;
  if message.source_kind='registration' then
    select registration.status,guardian.email::text as email,link.communication_permitted,
      coalesce(preference.optional_email_enabled,true) optional_email_enabled into source
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
        and token.used_at is null and token.revoked_at is null and token.expires_at>clock_timestamp() for share;
      if not found then return 'confirmation_token_superseded'; end if;
    elsif message.message_kind='registration_reminder' then
      if message.source_authorizing_user_id is null or not exists(select 1 from public.organization_members member
        where member.organization_id=message.organization_id and member.user_id=message.source_authorizing_user_id
          and member.status='active' and member.role in ('owner','administrator') for share)
      then return 'authorizer_offboarded'; end if;
    else return 'message_kind_invalid'; end if;
    return null;
  elsif message.source_kind='roster_decision' then
    select version.tryout_id,version.division_id,version.state,version.revision_number,decision.status,
      registration.status registration_status,registration.tryout_id registration_tryout_id,
      registration.division_id registration_division_id,guardian.email::text email,
      link.is_primary_contact,link.communication_permitted into source
    from public.roster_versions version
    join public.roster_decisions decision on decision.organization_id=version.organization_id
      and decision.roster_version_id=version.id and decision.registration_id=message.source_registration_id
    join public.tryout_registrations registration on registration.organization_id=decision.organization_id and registration.id=decision.registration_id
    join public.athlete_guardians link on link.organization_id=registration.organization_id
      and link.athlete_id=registration.athlete_id and link.guardian_id=message.source_guardian_id
    join public.guardians guardian on guardian.organization_id=link.organization_id and guardian.id=link.guardian_id
    where version.organization_id=message.organization_id and version.id=message.source_roster_version_id
    for share of version,decision,registration,link,guardian;
    if not found or source.state<>'finalized' or source.status<>message.source_expected_decision
      or source.registration_status<>'submitted' or source.registration_tryout_id<>source.tryout_id
      or source.registration_division_id<>source.division_id then return 'roster_decision_superseded'; end if;
    if message.source_tryout_id is not null and message.source_tryout_id<>source.tryout_id then return 'source_unverifiable'; end if;
    if message.source_division_id is not null and message.source_division_id<>source.division_id then return 'source_unverifiable'; end if;
    if not source.is_primary_contact or not source.communication_permitted then return 'recipient_suppressed'; end if;
    perform 1 from public.roster_versions version where version.organization_id=message.organization_id
      and version.tryout_id=source.tryout_id and version.division_id=source.division_id
      order by version.revision_number,version.id for share;
    if exists(select 1 from public.roster_versions newer where newer.organization_id=message.organization_id
      and newer.tryout_id=source.tryout_id and newer.division_id=source.division_id and newer.state='finalized'
      and newer.revision_number>source.revision_number) then return 'roster_decision_superseded'; end if;
    if lower(trim(source.email)) is distinct from message.recipient_snapshot->>'email' then return 'recipient_changed'; end if;
    if not private.can_user_authorize_roster_notice(message.source_authorizing_user_id,message.organization_id,source.tryout_id,source.division_id)
      then return 'authorizer_offboarded'; end if;
    return null;
  elsif message.source_kind='invitation' then
    select invitation.email::text email,invitation.token_digest,invitation.accepted_at,invitation.revoked_at,
      invitation.expires_at,invitation.created_by_user_id into source from public.organization_invitations invitation
    where invitation.organization_id=message.organization_id and invitation.id=message.source_id for share;
    if not found or source.accepted_at is not null or source.revoked_at is not null
      or source.expires_at<=clock_timestamp() or source.token_digest<>message.source_invitation_token_digest
      then return 'invitation_inactive'; end if;
    if lower(trim(source.email)) is distinct from message.recipient_snapshot->>'email' then return 'recipient_changed'; end if;
    if source.created_by_user_id<>message.source_authorizing_user_id or not exists(select 1 from public.organization_members member
      where member.organization_id=message.organization_id and member.user_id=message.source_authorizing_user_id
        and member.status='active' and member.role in ('owner','administrator') for share)
    then return 'authorizer_offboarded'; end if;
    return null;
  end if;
  return 'source_unverifiable';
end $$;

create function private.reconcile_pending_resend_events() returns trigger language plpgsql set search_path='' as $$
declare event record; applied text;
begin
  if new.provider_message_id is null then return new; end if;
  for event in select * from public.communication_pending_delivery_events pending
    where pending.message_id=new.id and pending.provider_message_id=new.provider_message_id order by pending.occurred_at,pending.event_id
  loop
    applied:=case when private.delivery_precedence(case event.event_type when 'sent' then 'submitted' else event.event_type end)>
      private.delivery_precedence(new.state) then case event.event_type when 'sent' then 'submitted' else event.event_type end else new.state end;
    new.state:=applied; new.submitted_at:=coalesce(new.submitted_at,event.occurred_at);
    new.delivery_state_at:=greatest(coalesce(new.delivery_state_at,'-infinity'::timestamptz),event.occurred_at);
    if applied in ('failed','bounced','suppressed','complained') then new.attention_required_at:=coalesce(new.attention_required_at,clock_timestamp()); end if;
    insert into public.communication_delivery_events(event_id,organization_id,message_id,provider_message_id,event_type,occurred_at,applied_state)
    values(event.event_id,new.organization_id,new.id,event.provider_message_id,event.event_type,event.occurred_at,applied)
    on conflict(event_id) do nothing;
  end loop;
  return new;
end $$;
create trigger reconcile_pending_resend_events before update of provider_message_id,state on public.communication_messages
for each row when(new.provider_message_id is not null) execute function private.reconcile_pending_resend_events();

create or replace function public.apply_resend_delivery_event(
  p_event_id text,p_message_id uuid,p_provider_message_id text,p_event_type text,p_occurred_at timestamptz
) returns text language plpgsql security definer set search_path='' as $$
declare target public.communication_messages%rowtype; next_state text; applied text;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_event_id !~ '^msg_[A-Za-z0-9_-]{8,200}$' or not private.is_canonical_provider_message_id(p_provider_message_id)
    or p_event_type not in ('sent','delivery_delayed','delivered','failed','bounced','suppressed','complained')
    or p_occurred_at is null or p_occurred_at>clock_timestamp()+interval '5 minutes' or p_occurred_at<clock_timestamp()-interval '1 year'
  then return 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended('resend-event:'||p_event_id,0));
  if exists(select 1 from public.communication_delivery_events where event_id=p_event_id union all
    select 1 from public.communication_pending_delivery_events where event_id=p_event_id) then
    return case when exists(select 1 from public.communication_delivery_events where event_id=p_event_id and message_id=p_message_id
      and provider_message_id=p_provider_message_id and event_type=p_event_type and occurred_at=p_occurred_at union all
      select 1 from public.communication_pending_delivery_events where event_id=p_event_id and message_id=p_message_id
      and provider_message_id=p_provider_message_id and event_type=p_event_type and occurred_at=p_occurred_at)
      then 'replayed' else 'event_conflict' end;
  end if;
  select * into target from public.communication_messages where id=p_message_id for update;
  if not found then return 'not_found'; end if;
  if target.provider_message_id is null and target.state='queued' then
    insert into public.communication_pending_delivery_events(event_id,message_id,provider_message_id,event_type,occurred_at)
    values(p_event_id,p_message_id,p_provider_message_id,p_event_type,p_occurred_at);
    return 'pending';
  end if;
  if target.provider_message_id is not null and target.provider_message_id<>p_provider_message_id then return 'provider_conflict'; end if;
  if target.provider_message_id is null and target.state<>'delivery_uncertain' then return 'provider_conflict'; end if;
  next_state:=case p_event_type when 'sent' then 'submitted' else p_event_type end;
  applied:=case when private.delivery_precedence(next_state)>private.delivery_precedence(target.state) then next_state else target.state end;
  update public.communication_messages set state=applied,provider_message_id=coalesce(provider_message_id,p_provider_message_id),
    submitted_at=coalesce(submitted_at,p_occurred_at),
    delivery_state_at=greatest(coalesce(delivery_state_at,'-infinity'::timestamptz),p_occurred_at),
    attention_required_at=case when applied in ('failed','bounced','suppressed','complained') then coalesce(attention_required_at,clock_timestamp()) else attention_required_at end
  where id=target.id;
  insert into public.communication_delivery_events(event_id,organization_id,message_id,provider_message_id,event_type,occurred_at,applied_state)
  values(p_event_id,target.organization_id,target.id,p_provider_message_id,p_event_type,p_occurred_at,applied);
  if target.state='delivery_uncertain' then
    update public.outbox_jobs set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),
      delivery_uncertain_at=null,delivery_uncertain_reason=null,last_error_code=null,
      lease_owner=null,lease_token=null,lease_expires_at=null
    where message_id=target.id and status='needs_attention';
    update public.outbox_provider_handoffs set attempt_state='event_confirmed',resolved_at=clock_timestamp(),
      provider_message_id=p_provider_message_id
    where job_id in(select id from public.outbox_jobs where message_id=target.id and status='completed')
      and attempt_state='delivery_uncertain';
  end if;
  return applied;
end $$;

-- If a callback won the race immediately before an ambiguous transport result,
-- consume that already-authenticated evidence while recording uncertainty.
create or replace function private.mark_outbox_delivery_uncertain(p_job_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare seed record; target record; pending_provider text; pending_state text;
begin
  if p_reason !~ '^[a-z][a-z0-9_]{2,63}$' then raise exception 'invalid uncertainty reason' using errcode='22023'; end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  perform 1 from public.communication_messages where id=seed.message_id for update;
  update public.outbox_jobs set status='needs_attention',last_error_code=p_reason,
    delivery_uncertain_at=coalesce(delivery_uncertain_at,clock_timestamp()),delivery_uncertain_reason=p_reason,
    lease_expires_at=null where id=p_job_id and status in ('pending','leased','needs_attention')
    and provider_submission_started_at is not null returning organization_id,message_id into target;
  if not found then return; end if;
  update public.communication_messages set state='delivery_uncertain',cancellation_reason=null,
    attention_required_at=coalesce(attention_required_at,clock_timestamp())
  where id=target.message_id and state in ('queued','delivery_uncertain');
  if (select count(distinct provider_message_id)=1 from public.communication_pending_delivery_events
    where message_id=target.message_id) then
    select provider_message_id,case event_type when 'sent' then 'submitted' else event_type end
      into pending_provider,pending_state from public.communication_pending_delivery_events
      where message_id=target.message_id
      order by private.delivery_precedence(case event_type when 'sent' then 'submitted' else event_type end) desc,
        occurred_at desc,event_id desc limit 1;
  end if;
  if pending_provider is not null then
    update public.communication_messages set state=pending_state,provider_message_id=pending_provider,
      submitted_at=coalesce(submitted_at,clock_timestamp()),attention_required_at=case
        when pending_state in ('failed','bounced','suppressed','complained') then coalesce(attention_required_at,clock_timestamp()) else null end
    where id=target.message_id;
    update public.outbox_jobs set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),
      delivery_uncertain_at=null,delivery_uncertain_reason=null,last_error_code=null,
      lease_owner=null,lease_token=null,lease_expires_at=null where id=p_job_id;
    update public.outbox_provider_handoffs set attempt_state='event_confirmed',resolved_at=clock_timestamp(),
      provider_message_id=pending_provider where job_id=p_job_id and attempt_state='delivery_uncertain';
  end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  select target.organization_id,null,'communication.delivery_uncertain','communication_message',target.message_id,
    jsonb_build_object('reason',p_reason) where not exists(select 1 from public.audit_logs audit
      where audit.organization_id=target.organization_id and audit.action='communication.delivery_uncertain'
        and audit.entity_id=target.message_id and audit.details->>'reason'=p_reason);
end $$;

create or replace function public.fail_outbox_job_v2(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_send_attempt_token uuid,
  p_error_code text,p_retryable boolean
) returns text language plpgsql security definer set search_path='' as $$
declare target public.outbox_jobs%rowtype; changed uuid; terminal boolean;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_error_code !~ '^[a-z][a-z0-9_]{2,63}$' then return 'invalid_input'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation
    then return 'lease_conflict'; end if;
  if p_error_code='provider_timeout_uncertain' then
    update public.outbox_provider_handoffs set attempt_state='delivery_uncertain',resolved_at=clock_timestamp()
    where job_id=p_job_id and send_attempt_token=p_send_attempt_token and attempt_state='authorized'
    returning send_attempt_token into changed;
    if changed is null then return 'attempt_conflict'; end if;
    perform private.mark_outbox_delivery_uncertain(p_job_id,p_error_code);
    return case when exists(select 1 from public.outbox_jobs where id=p_job_id and status='completed')
      then 'completed' else 'needs_attention' end;
  end if;
  update public.outbox_provider_handoffs set attempt_state='provider_failed',resolved_at=clock_timestamp()
  where job_id=p_job_id and send_attempt_token=p_send_attempt_token and attempt_state='authorized'
  returning send_attempt_token into changed;
  if changed is null then return 'attempt_conflict'; end if;
  terminal:=not p_retryable or target.attempt_count>=target.max_attempts;
  if terminal then
    update public.outbox_jobs set status='dead_letter',last_error_code=p_error_code,dead_lettered_at=clock_timestamp(),
      provider_submission_started_at=null,lease_owner=null,lease_token=null,lease_expires_at=null where id=p_job_id;
    update public.communication_messages set state='failed',attention_required_at=clock_timestamp() where id=target.message_id;
    return 'dead_lettered';
  end if;
  update public.outbox_jobs set status='pending',last_error_code=p_error_code,provider_submission_started_at=null,
    lease_owner=null,lease_token=null,lease_expires_at=null,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,
      30*(2::numeric^greatest(0,target.attempt_count-1))
      +((hashtextextended(target.id::text||':'||target.lease_generation::text,0)&1023)%11))::integer)
  where id=p_job_id;
  return 'retry_scheduled';
end $$;

alter table public.communication_preview_proofs enable row level security;
alter table public.communication_pending_delivery_events enable row level security;
revoke all on public.communication_preview_proofs,public.communication_pending_delivery_events from public,anon,authenticated,service_role;
revoke execute on function public.create_decision_message_batch(uuid,uuid,bigint,text,text,text,uuid[],text) from authenticated;
revoke all on function public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text),public.save_communication_template(uuid,text,text,bigint) from public,anon;
grant execute on function public.create_decision_message_batch_v2(uuid,uuid,uuid,uuid,text,text,text),public.save_communication_template(uuid,text,text,bigint) to authenticated;
revoke all on function private.render_decision_message_payload(uuid,uuid,text,text),private.reconcile_pending_resend_events(),private.lock_communication_source_reason(uuid),private.mark_outbox_delivery_uncertain(uuid,text) from public,anon,authenticated,service_role;

create trigger prevent_pending_delivery_events_mutation before update or delete on public.communication_pending_delivery_events
for each row execute function private.prevent_communication_evidence_mutation();
alter table public.communication_pending_delivery_events enable always trigger prevent_pending_delivery_events_mutation;
