-- Task 23 review round 4: close every nullable public decision-message boundary.

create or replace function public.create_decision_message_batch_v2(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_preview_token text,p_preview_digest text,p_confirmation text
) returns public.decision_message_batch_result language plpgsql security definer set search_path='' as $$
declare proof public.communication_preview_proofs%rowtype; tombstone public.communication_preview_tombstones%rowtype;
  current_payload jsonb; current_digest text; existing public.communication_batches%rowtype;
  new_batch uuid:=gen_random_uuid(); row jsonb; message_id uuid; job_id uuid; queued integer:=0; facts jsonb;
  token_hash text; binding_hash text; template public.communication_templates%rowtype; current_actor_id uuid:=auth.uid();
begin
  if current_actor_id is null or p_organization_id is null or p_tryout_id is null
    or p_division_id is null or p_roster_version_id is null or p_preview_token is null
    or p_preview_digest is null or p_confirmation is null
    or p_confirmation is distinct from 'SEND EXACT BATCH'
    or p_preview_token !~ '^[0-9a-f]{64}$' or p_preview_digest !~ '^[0-9a-f]{64}$'
  then return ('invalid_input',null,0)::public.decision_message_batch_result; end if;
  token_hash:=encode(extensions.digest(convert_to(p_preview_token,'UTF8'),'sha256'),'hex');
  binding_hash:=encode(extensions.digest(convert_to(p_organization_id::text||':'||p_tryout_id::text||':'||
    p_division_id::text||':'||p_roster_version_id::text||':'||current_actor_id::text,'UTF8'),'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'communication-preview-confirmation-v2:'||token_hash,0));

  select * into tombstone from public.communication_preview_tombstones where token_digest=token_hash;
  if found then
    if tombstone.binding_digest is distinct from binding_hash
      then return ('forbidden',null,0)::public.decision_message_batch_result; end if;
    if tombstone.render_digest is distinct from p_preview_digest
      then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
    return ('replayed',tombstone.communication_batch_id,
      (select recipient_count from public.communication_batches where id=tombstone.communication_batch_id))::public.decision_message_batch_result;
  end if;
  select * into proof from public.communication_preview_proofs where token_digest=token_hash for update;
  if not found or proof.organization_id is distinct from p_organization_id
    or proof.tryout_id is distinct from p_tryout_id or proof.division_id is distinct from p_division_id
    or proof.roster_version_id is distinct from p_roster_version_id
    or proof.actor_user_id is distinct from current_actor_id
  then return ('forbidden',null,0)::public.decision_message_batch_result; end if;
  if proof.expires_at<=clock_timestamp() or proof.render_digest is distinct from p_preview_digest
    or private.can_user_authorize_roster_notice(
      current_actor_id,proof.organization_id,proof.tryout_id,proof.division_id
    ) is distinct from true
  then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  if proof.template_id is not distinct from 'builtin:'||proof.decision then
    if proof.template_version is distinct from 1
      or proof.template_content is distinct from 'Thank you for taking part in this tryout.'
    then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  else
    select * into template from public.communication_templates where organization_id=proof.organization_id
      and id=proof.template_id::uuid and message_kind=proof.decision;
    if not found or template.version is distinct from proof.template_version
      or template.editable_text is distinct from proof.template_content
    then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  end if;
  perform 1 from public.roster_versions where organization_id=proof.organization_id
    and id=proof.roster_version_id for update;
  current_payload:=private.render_decision_message_payload(
    proof.organization_id,proof.roster_version_id,proof.decision,proof.editable_text
  )||jsonb_build_object('template_id',proof.template_id,'template_version',proof.template_version,
      'template_content',proof.template_content);
  current_digest:=encode(extensions.digest(convert_to(current_payload::text,'UTF8'),'sha256'),'hex');
  if current_payload->>'outcome' is distinct from 'ok'
    or current_digest is distinct from proof.render_digest
    or current_payload is distinct from proof.payload_snapshot
  then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  select * into existing from public.communication_batches where organization_id=proof.organization_id
    and preview_digest=proof.render_digest;
  if found then
    insert into public.communication_preview_tombstones(token_digest,render_digest,binding_digest,communication_batch_id)
      values(proof.token_digest,proof.render_digest,binding_hash,existing.id);
    delete from public.communication_preview_proofs where token_digest=proof.token_digest;
    return ('replayed',existing.id,existing.recipient_count)::public.decision_message_batch_result;
  end if;
  insert into public.communication_batches(id,organization_id,roster_version_id,roster_version,decision,
    editable_text,preview_digest,recipient_count,created_by_user_id,template_id,template_version,template_content)
  values(new_batch,proof.organization_id,proof.roster_version_id,proof.roster_version,proof.decision,
    proof.editable_text,proof.render_digest,(current_payload->>'count')::integer,current_actor_id,
    proof.template_id,proof.template_version,proof.template_content);
  for row in select value from jsonb_array_elements(current_payload->'rows') rows(value) loop
    message_id:=gen_random_uuid(); job_id:=gen_random_uuid();
    facts:=jsonb_build_object('organization_name',row->>'organization_name','tryout_name',row->>'tryout_name',
      'division_name',row->>'division_name','athlete_preferred_name',row->>'athlete_preferred_name',
      'decision',proof.decision,'team_name',row->'team_name','roster_version_id',proof.roster_version_id,
      'roster_version',proof.roster_version,'recipient_registration_id',row->>'registration_id',
      'recipient_guardian_id',row->>'guardian_id','recipient_email',row->>'recipient_email','link_facts',row->'link_facts',
      'template_id',proof.template_id,'template_version',proof.template_version);
    insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
      business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,source_binding_version,
      source_registration_id,source_guardian_id,source_roster_version_id,source_expected_decision,
      source_authorizing_user_id,communication_batch_id,protected_facts_snapshot,source_tryout_id,source_division_id,
      source_template_id,source_template_version)
    values(message_id,proof.organization_id,'roster_decision',proof.roster_version_id,'roster_decision_notice','operational',
      'decision-batch:'||new_batch||':'||(row->>'registration_id'),
      encode(extensions.digest(convert_to(proof.render_digest||':'||(row->>'registration_id'),'UTF8'),'sha256'),'hex'),
      jsonb_build_object('email',row->>'recipient_email'),jsonb_build_object('subject',row->>'subject','text',row->>'text','html',row->>'html'),
      1,(row->>'registration_id')::uuid,(row->>'guardian_id')::uuid,proof.roster_version_id,proof.decision,
      current_actor_id,new_batch,facts,proof.tryout_id,proof.division_id,proof.template_id,proof.template_version);
    insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
    values(job_id,proof.organization_id,message_id,'decision-batch:'||new_batch||':'||(row->>'registration_id'),'communication:'||message_id);
    queued:=queued+1;
  end loop;
  insert into public.communication_preview_tombstones(token_digest,render_digest,binding_digest,communication_batch_id)
    values(proof.token_digest,proof.render_digest,binding_hash,new_batch);
  delete from public.communication_preview_proofs where token_digest=proof.token_digest;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(proof.organization_id,current_actor_id,'communication.batch_created','communication_batch',new_batch,
    jsonb_build_object('decision',proof.decision,'recipient_count',queued,'roster_version_id',proof.roster_version_id,
      'template_id',proof.template_id,'template_version',proof.template_version));
  return ('queued',new_batch,queued)::public.decision_message_batch_result;
end $$;

create or replace function public.preview_decision_message_batch_v2(
  p_organization_id uuid,p_roster_version_id uuid,p_decision text,p_editable_text text,
  p_template_id text,p_expected_template_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; payload jsonb; render_digest text; recipient_digest text;
  token text:=encode(extensions.gen_random_bytes(32),'hex'); issued timestamptz:=clock_timestamp();
  template public.communication_templates%rowtype; template_content text; current_actor_id uuid:=auth.uid();
begin
  if current_actor_id is null or p_organization_id is null or p_roster_version_id is null
    or p_decision is null or p_editable_text is null or p_template_id is null
    or p_expected_template_version is null
    or p_decision not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000
    or p_expected_template_version not between 1 and 9007199254740991
  then return jsonb_build_object('outcome','invalid_input'); end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id and id=p_roster_version_id;
  if not found or private.can_user_authorize_roster_notice(
    current_actor_id,p_organization_id,roster.tryout_id,roster.division_id
  ) is distinct from true then return jsonb_build_object('outcome','forbidden'); end if;
  if p_template_id is not distinct from 'builtin:'||p_decision then
    if p_expected_template_version is distinct from 1
      then return jsonb_build_object('outcome','stale_template'); end if;
    template_content:='Thank you for taking part in this tryout.';
  elsif p_template_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into template from public.communication_templates where organization_id=p_organization_id
      and id=p_template_id::uuid and message_kind=p_decision;
    if not found then return jsonb_build_object('outcome','stale_template'); end if;
    if template.version is distinct from p_expected_template_version
      then return jsonb_build_object('outcome','stale_template'); end if;
    template_content:=template.editable_text;
  else return jsonb_build_object('outcome','invalid_input'); end if;
  perform pg_advisory_xact_lock(hashtextextended('communication-preview-rate:'||
    p_organization_id::text||':'||current_actor_id::text,0));
  perform private.purge_expired_communication_previews_for_tenant(p_organization_id,100);
  if (select count(*) from public.communication_preview_proofs proof
      where proof.organization_id=p_organization_id and proof.actor_user_id=current_actor_id
        and proof.expires_at>clock_timestamp())>=20
    or (select count(*) from public.communication_preview_proofs proof
      where proof.organization_id=p_organization_id and proof.actor_user_id=current_actor_id
        and proof.issued_at>clock_timestamp()-interval '1 minute')>=10
  then return jsonb_build_object('outcome','rate_limited'); end if;
  payload:=private.render_decision_message_payload(p_organization_id,p_roster_version_id,p_decision,p_editable_text);
  if payload->>'outcome' is distinct from 'ok' then return payload; end if;
  payload:=payload||jsonb_build_object('template_id',p_template_id,
    'template_version',p_expected_template_version,'template_content',template_content);
  render_digest:=encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');
  recipient_digest:=encode(extensions.digest(convert_to((select jsonb_agg(jsonb_build_object(
    'registration_id',r->>'registration_id','guardian_id',r->>'guardian_id','recipient_email',r->>'recipient_email')
    order by r->>'registration_id') from jsonb_array_elements(payload->'rows') r)::text,'UTF8'),'sha256'),'hex');
  insert into public.communication_preview_proofs(token_digest,organization_id,tryout_id,division_id,
    roster_version_id,roster_version,decision,editable_text,render_digest,recipient_digest,payload_snapshot,
    actor_user_id,issued_at,expires_at,template_id,template_version,template_content)
  values(encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),p_organization_id,
    (payload->>'tryout_id')::uuid,(payload->>'division_id')::uuid,p_roster_version_id,
    (payload->>'roster_version')::bigint,p_decision,trim(p_editable_text),render_digest,recipient_digest,
    payload,current_actor_id,issued,issued+interval '10 minutes',p_template_id,p_expected_template_version,template_content);
  return jsonb_build_object('outcome','ok','organizationId',p_organization_id,
    'tryoutId',payload->>'tryout_id','divisionId',payload->>'division_id',
    'rosterVersionId',p_roster_version_id,'rosterVersion',(payload->>'roster_version')::bigint,
    'kind',p_decision,'editableText',trim(p_editable_text),'templateId',p_template_id,
    'templateVersion',p_expected_template_version,'count',(payload->>'count')::integer,
    'digest',render_digest,'recipientDigest',recipient_digest,'previewToken',token,
    'issuedAt',issued,'expiresAt',issued+interval '10 minutes','recipients',
    (select jsonb_agg(jsonb_build_object('registrationId',r->>'registration_id',
      'recipientEmail',r->>'recipient_email','athletePreferredName',r->>'athlete_preferred_name',
      'subject',r->>'subject','text',r->>'text','html',r->>'html') order by r->>'registration_id')
     from jsonb_array_elements(payload->'rows') r));
end $$;

create or replace function public.save_communication_template(
  p_organization_id uuid,p_message_kind text,p_editable_text text,p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.communication_templates%rowtype; next_version bigint; saved_id uuid;
  current_actor_id uuid:=auth.uid();
begin
  if current_actor_id is null or p_organization_id is null or p_message_kind is null
    or p_editable_text is null or p_expected_version is null
    or p_message_kind not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000
    or p_expected_version not between 0 and 9007199254740990
  then return jsonb_build_object('outcome','invalid_input'); end if;
  if public.is_active_organization_member(p_organization_id,array['owner','administrator']) is distinct from true
    then return jsonb_build_object('outcome','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'communication-template:'||p_organization_id::text||':'||p_message_kind,0
  ));
  select * into existing from public.communication_templates where organization_id=p_organization_id
    and message_kind=p_message_kind for update;
  if found and existing.version is distinct from p_expected_version
    then return jsonb_build_object('outcome','version_conflict','version',existing.version,'templateId',existing.id); end if;
  if not found and p_expected_version is distinct from 0
    then return jsonb_build_object('outcome','version_conflict','version',0); end if;
  next_version:=p_expected_version+1;
  insert into public.communication_templates(organization_id,message_kind,editable_text,version,updated_by_user_id)
  values(p_organization_id,p_message_kind,trim(p_editable_text),next_version,current_actor_id)
  on conflict(organization_id,message_kind) do update set editable_text=excluded.editable_text,
    version=excluded.version,updated_by_user_id=excluded.updated_by_user_id returning id into saved_id;
  return jsonb_build_object('outcome','saved','version',next_version,'templateId',saved_id,
    'editableText',trim(p_editable_text));
end $$;

create or replace function public.list_communication_templates_for_notice(
  p_organization_id uuid,p_tryout_id uuid
) returns table(id uuid,message_kind text,editable_text text,version bigint)
language plpgsql security definer set search_path='' as $$
declare current_actor_id uuid:=auth.uid();
begin
  if current_actor_id is null or p_organization_id is null or p_tryout_id is null or not exists(
    select 1 from public.roster_versions roster where roster.organization_id=p_organization_id
      and roster.tryout_id=p_tryout_id and private.can_user_authorize_roster_notice(
        current_actor_id,p_organization_id,p_tryout_id,roster.division_id
      ) is not distinct from true
  ) then raise exception 'forbidden' using errcode='42501'; end if;
  return query select template.id,template.message_kind,template.editable_text,template.version
    from public.communication_templates template where template.organization_id=p_organization_id
    order by template.message_kind;
end $$;

create or replace function public.purge_expired_communication_previews(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare deleted_count integer;
begin
  if auth.role() is distinct from 'service_role'
    and nullif(current_setting('role',true),'none') is distinct from 'service_role'
    then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 500
    then raise exception 'invalid purge limit' using errcode='22023'; end if;
  with victims as(
    select proof.token_digest from public.communication_preview_proofs proof
    where proof.expires_at<=clock_timestamp()-interval '5 minutes'
    order by proof.expires_at,proof.token_digest limit p_limit for update skip locked
  ) delete from public.communication_preview_proofs proof using victims
    where proof.token_digest=victims.token_digest;
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;

create or replace function public.apply_resend_delivery_event(
  p_event_id text,p_message_id uuid,p_provider_message_id text,p_event_type text,p_occurred_at timestamptz
) returns text language plpgsql security definer set search_path='' as $$
declare target public.communication_messages%rowtype; next_state text; applied text;
begin
  if auth.role() is distinct from 'service_role'
    and nullif(current_setting('role',true),'none') is distinct from 'service_role'
    then raise exception 'forbidden' using errcode='42501'; end if;
  if p_event_id is null or p_message_id is null or p_provider_message_id is null
    or p_event_type is null or p_occurred_at is null
    or p_event_id !~ '^msg_[A-Za-z0-9_-]{8,200}$'
    or private.is_canonical_provider_message_id(p_provider_message_id) is distinct from true
    or p_event_type not in ('sent','delivery_delayed','delivered','failed','bounced','suppressed','complained')
    or p_occurred_at>clock_timestamp()+interval '5 minutes'
    or p_occurred_at<clock_timestamp()-interval '1 year'
  then return 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended('resend-event:'||p_event_id,0));
  if exists(select 1 from public.communication_delivery_events where event_id=p_event_id union all
    select 1 from public.communication_pending_delivery_events where event_id=p_event_id) then
    return case when exists(select 1 from public.communication_delivery_events where event_id=p_event_id
      and message_id is not distinct from p_message_id
      and provider_message_id is not distinct from p_provider_message_id
      and event_type is not distinct from p_event_type and occurred_at is not distinct from p_occurred_at union all
      select 1 from public.communication_pending_delivery_events where event_id=p_event_id
      and message_id is not distinct from p_message_id
      and provider_message_id is not distinct from p_provider_message_id
      and event_type is not distinct from p_event_type and occurred_at is not distinct from p_occurred_at)
      then 'replayed' else 'event_conflict' end;
  end if;
  select * into target from public.communication_messages where id=p_message_id for update;
  if not found then return 'not_found'; end if;
  if target.provider_message_id is null and target.state='queued' then
    insert into public.communication_pending_delivery_events(event_id,message_id,provider_message_id,event_type,occurred_at)
    values(p_event_id,p_message_id,p_provider_message_id,p_event_type,p_occurred_at);
    return 'pending';
  end if;
  if target.provider_message_id is not null
    and target.provider_message_id is distinct from p_provider_message_id then return 'provider_conflict'; end if;
  if target.provider_message_id is null and target.state is distinct from 'delivery_uncertain'
    then return 'provider_conflict'; end if;
  next_state:=case p_event_type when 'sent' then 'submitted' else p_event_type end;
  applied:=case when private.delivery_precedence(next_state)>private.delivery_precedence(target.state)
    then next_state else target.state end;
  update public.communication_messages set state=applied,provider_message_id=coalesce(provider_message_id,p_provider_message_id),
    submitted_at=coalesce(submitted_at,p_occurred_at),
    delivery_state_at=greatest(coalesce(delivery_state_at,'-infinity'::timestamptz),p_occurred_at),
    attention_required_at=case when applied in ('failed','bounced','suppressed','complained')
      then coalesce(attention_required_at,clock_timestamp()) else attention_required_at end
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
