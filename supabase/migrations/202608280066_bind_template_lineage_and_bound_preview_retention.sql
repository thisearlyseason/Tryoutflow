-- Task 23 review round 2: template lineage, bounded preview privacy, and exact early evidence.

alter table public.communication_templates add column id uuid not null default gen_random_uuid();
alter table public.communication_templates add constraint communication_templates_org_id_key
  unique(organization_id,id);

alter table public.communication_batches
  add column template_id text,
  add column template_version bigint,
  add column template_content text;
alter table public.communication_batches disable trigger prevent_communication_batches_mutation;
update public.communication_batches set template_id='legacy:unversioned',template_version=1,
  template_content=editable_text where template_id is null;
alter table public.communication_batches enable always trigger prevent_communication_batches_mutation;
alter table public.communication_batches
  alter column template_id set not null,
  alter column template_version set not null,
  alter column template_content set not null,
  add constraint communication_batches_template_id_check check(template_id ~ '^(builtin:[a-z]+|legacy:unversioned|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'),
  add constraint communication_batches_template_version_check check(template_version between 1 and 9007199254740991),
  add constraint communication_batches_template_content_check check(char_length(trim(template_content)) between 1 and 4000);
alter table public.communication_batches add constraint communication_batches_template_lineage_key
  unique(organization_id,id,template_id,template_version);

alter table public.communication_messages
  add column source_template_id text,
  add column source_template_version bigint;
alter table public.communication_messages drop constraint communication_messages_protected_facts_shape;
update public.communication_messages message set
  source_template_id=batch.template_id,source_template_version=batch.template_version,
  protected_facts_snapshot=message.protected_facts_snapshot||jsonb_build_object(
    'template_id',batch.template_id,'template_version',batch.template_version)
from public.communication_batches batch where batch.id=message.communication_batch_id;
alter table public.communication_messages add constraint communication_messages_batch_template_fkey
  foreign key(organization_id,communication_batch_id,source_template_id,source_template_version)
  references public.communication_batches(organization_id,id,template_id,template_version) on delete restrict;

alter table public.communication_messages add constraint communication_messages_protected_facts_shape check(
  communication_batch_id is null and protected_facts_snapshot='{}'::jsonb
    and source_template_id is null and source_template_version is null
  or communication_batch_id is not null and source_template_id is not null
    and source_template_version between 1 and 9007199254740991
    and jsonb_typeof(protected_facts_snapshot)='object'
    and protected_facts_snapshot ?& array['organization_name','tryout_name','division_name',
      'athlete_preferred_name','decision','team_name','roster_version_id','roster_version',
      'recipient_registration_id','recipient_guardian_id','recipient_email','link_facts',
      'template_id','template_version']
    and protected_facts_snapshot-array['organization_name','tryout_name','division_name',
      'athlete_preferred_name','decision','team_name','roster_version_id','roster_version',
      'recipient_registration_id','recipient_guardian_id','recipient_email','link_facts',
      'template_id','template_version']='{}'::jsonb
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
    and jsonb_typeof(protected_facts_snapshot->'template_id')='string'
    and jsonb_typeof(protected_facts_snapshot->'template_version')='number'
    and protected_facts_snapshot->>'template_id'=source_template_id
    and (protected_facts_snapshot->>'template_version')::bigint=source_template_version
    and (protected_facts_snapshot->'link_facts')='{"is_primary_contact":true,
      "communication_permitted":true,"action_href":null,"action_label":null}'::jsonb
);

create table public.communication_preview_tombstones (
  token_digest text primary key,
  render_digest text not null,
  binding_digest text not null,
  communication_batch_id uuid not null,
  consumed_at timestamptz not null default clock_timestamp(),
  constraint communication_preview_tombstones_token_check check(token_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_preview_tombstones_render_check check(render_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_preview_tombstones_binding_check check(binding_digest ~ '^[0-9a-f]{64}$'),
  constraint communication_preview_tombstones_batch_fkey foreign key(communication_batch_id)
    references public.communication_batches(id) on delete restrict
);

insert into public.communication_preview_tombstones(token_digest,render_digest,binding_digest,
  communication_batch_id,consumed_at)
select token_digest,render_digest,encode(extensions.digest(convert_to(
  organization_id::text||':'||tryout_id::text||':'||division_id::text||':'||
  roster_version_id::text||':'||actor_user_id::text,'UTF8'),'sha256'),'hex'),communication_batch_id,consumed_at
from public.communication_preview_proofs where consumed_at is not null;
delete from public.communication_preview_proofs;

alter table public.communication_preview_proofs
  add column template_id text not null,
  add column template_version bigint not null,
  add column template_content text not null,
  add constraint communication_preview_proofs_template_id_check check(template_id ~ '^(builtin:[a-z]+|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'),
  add constraint communication_preview_proofs_template_version_check check(template_version between 1 and 9007199254740991),
  add constraint communication_preview_proofs_template_content_check check(char_length(trim(template_content)) between 1 and 4000);
alter table public.communication_preview_proofs drop constraint communication_preview_proofs_consume_check;
alter table public.communication_preview_proofs drop constraint communication_preview_proofs_batch_fkey;
alter table public.communication_preview_proofs drop column consumed_at,drop column communication_batch_id;
alter table public.communication_preview_proofs drop constraint communication_preview_proofs_org_fkey;
alter table public.communication_preview_proofs drop constraint communication_preview_proofs_roster_fkey;
alter table public.communication_preview_proofs drop constraint communication_preview_proofs_actor_fkey;
alter table public.communication_preview_proofs add constraint communication_preview_proofs_org_fkey
  foreign key(organization_id) references public.organizations(id) on delete cascade;
alter table public.communication_preview_proofs add constraint communication_preview_proofs_roster_fkey
  foreign key(organization_id,roster_version_id) references public.roster_versions(organization_id,id) on delete cascade;
alter table public.communication_preview_proofs add constraint communication_preview_proofs_actor_fkey
  foreign key(actor_user_id) references auth.users(id) on delete cascade;

create index communication_preview_proofs_active_actor_idx
  on public.communication_preview_proofs(organization_id,actor_user_id,issued_at);
alter table public.communication_preview_tombstones enable row level security;
revoke all on public.communication_preview_tombstones from public,anon,authenticated,service_role;

create function private.purge_expired_communication_previews_for_tenant(
  p_organization_id uuid,p_limit integer
) returns integer language plpgsql security definer set search_path='' as $$
declare deleted_count integer;
begin
  if p_limit not between 1 and 500 then raise exception 'invalid purge limit' using errcode='22023'; end if;
  with victims as(
    select proof.token_digest from public.communication_preview_proofs proof
    where proof.organization_id=p_organization_id
      and proof.expires_at<=clock_timestamp()-interval '5 minutes'
    order by proof.expires_at,proof.token_digest limit p_limit for update skip locked
  ) delete from public.communication_preview_proofs proof using victims
    where proof.token_digest=victims.token_digest;
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;

create function public.purge_expired_communication_previews(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare deleted_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_limit not between 1 and 500 then raise exception 'invalid purge limit' using errcode='22023'; end if;
  with victims as(
    select proof.token_digest from public.communication_preview_proofs proof
    where proof.expires_at<=clock_timestamp()-interval '5 minutes'
    order by proof.expires_at,proof.token_digest limit p_limit for update skip locked
  ) delete from public.communication_preview_proofs proof using victims
    where proof.token_digest=victims.token_digest;
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;

create function public.list_communication_templates_for_notice(p_organization_id uuid,p_tryout_id uuid)
returns table(id uuid,message_kind text,editable_text text,version bigint)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.roster_versions roster where roster.organization_id=p_organization_id
      and roster.tryout_id=p_tryout_id and private.can_user_authorize_roster_notice(
        auth.uid(),p_organization_id,p_tryout_id,roster.division_id)
  ) then raise exception 'forbidden' using errcode='42501'; end if;
  return query select template.id,template.message_kind,template.editable_text,template.version
    from public.communication_templates template where template.organization_id=p_organization_id
    order by template.message_kind;
end $$;

create function public.preview_decision_message_batch_v2(
  p_organization_id uuid,p_roster_version_id uuid,p_decision text,p_editable_text text,
  p_template_id text,p_expected_template_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; payload jsonb; render_digest text; recipient_digest text;
  token text:=encode(extensions.gen_random_bytes(32),'hex'); issued timestamptz:=clock_timestamp();
  template public.communication_templates%rowtype; template_content text;
begin
  if auth.uid() is null or p_decision not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000
    or p_template_id is null or p_expected_template_version not between 1 and 9007199254740991
  then return jsonb_build_object('outcome','invalid_input'); end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id and id=p_roster_version_id;
  if not found or not private.can_user_authorize_roster_notice(auth.uid(),p_organization_id,roster.tryout_id,roster.division_id)
    then return jsonb_build_object('outcome','forbidden'); end if;
  if p_template_id='builtin:'||p_decision then
    if p_expected_template_version<>1 then return jsonb_build_object('outcome','stale_template'); end if;
    template_content:='Thank you for taking part in this tryout.';
  elsif p_template_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into template from public.communication_templates where organization_id=p_organization_id
      and id=p_template_id::uuid and message_kind=p_decision;
    if not found then return jsonb_build_object('outcome','stale_template'); end if;
    if template.version<>p_expected_template_version then return jsonb_build_object('outcome','stale_template'); end if;
    template_content:=template.editable_text;
  else return jsonb_build_object('outcome','invalid_input'); end if;
  perform pg_advisory_xact_lock(hashtextextended('communication-preview-rate:'||
    p_organization_id::text||':'||auth.uid()::text,0));
  perform private.purge_expired_communication_previews_for_tenant(p_organization_id,100);
  if (select count(*) from public.communication_preview_proofs proof
      where proof.organization_id=p_organization_id and proof.actor_user_id=auth.uid()
        and proof.expires_at>clock_timestamp())>=20
    or (select count(*) from public.communication_preview_proofs proof
      where proof.organization_id=p_organization_id and proof.actor_user_id=auth.uid()
        and proof.issued_at>clock_timestamp()-interval '1 minute')>=10
  then return jsonb_build_object('outcome','rate_limited'); end if;
  payload:=private.render_decision_message_payload(p_organization_id,p_roster_version_id,p_decision,p_editable_text);
  if payload->>'outcome'<>'ok' then return payload; end if;
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
    payload,auth.uid(),issued,issued+interval '10 minutes',p_template_id,p_expected_template_version,template_content);
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

create or replace function public.create_decision_message_batch_v2(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_preview_token text,p_preview_digest text,p_confirmation text
) returns public.decision_message_batch_result language plpgsql security definer set search_path='' as $$
declare proof public.communication_preview_proofs%rowtype; tombstone public.communication_preview_tombstones%rowtype;
  current_payload jsonb; current_digest text; existing public.communication_batches%rowtype;
  new_batch uuid:=gen_random_uuid(); row jsonb; message_id uuid; job_id uuid; queued integer:=0; facts jsonb;
  token_hash text; binding_hash text; template public.communication_templates%rowtype;
begin
  if auth.uid() is null or p_confirmation<>'SEND EXACT BATCH' or p_preview_token !~ '^[0-9a-f]{64}$'
    or p_preview_digest !~ '^[0-9a-f]{64}$'
  then return ('invalid_input',null,0)::public.decision_message_batch_result; end if;
  token_hash:=encode(extensions.digest(convert_to(p_preview_token,'UTF8'),'sha256'),'hex');
  binding_hash:=encode(extensions.digest(convert_to(p_organization_id::text||':'||p_tryout_id::text||':'||
    p_division_id::text||':'||p_roster_version_id::text||':'||auth.uid()::text,'UTF8'),'sha256'),'hex');
  select * into tombstone from public.communication_preview_tombstones where token_digest=token_hash;
  if found then
    if tombstone.binding_digest<>binding_hash then return ('forbidden',null,0)::public.decision_message_batch_result; end if;
    if tombstone.render_digest<>p_preview_digest then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
    return ('replayed',tombstone.communication_batch_id,
      (select recipient_count from public.communication_batches where id=tombstone.communication_batch_id))::public.decision_message_batch_result;
  end if;
  select * into proof from public.communication_preview_proofs where token_digest=token_hash for update;
  if not found or proof.organization_id<>p_organization_id or proof.tryout_id<>p_tryout_id
    or proof.division_id<>p_division_id or proof.roster_version_id<>p_roster_version_id
    or proof.actor_user_id<>auth.uid() then return ('forbidden',null,0)::public.decision_message_batch_result; end if;
  if proof.expires_at<=clock_timestamp() or proof.render_digest<>p_preview_digest
    or not private.can_user_authorize_roster_notice(auth.uid(),proof.organization_id,proof.tryout_id,proof.division_id)
  then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  if proof.template_id='builtin:'||proof.decision then
    if proof.template_version<>1 or proof.template_content<>'Thank you for taking part in this tryout.'
      then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  else
    select * into template from public.communication_templates where organization_id=proof.organization_id
      and id=proof.template_id::uuid and message_kind=proof.decision;
    if not found or template.version<>proof.template_version or template.editable_text<>proof.template_content
      then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  end if;
  perform 1 from public.roster_versions where organization_id=proof.organization_id and id=proof.roster_version_id for update;
  current_payload:=private.render_decision_message_payload(proof.organization_id,proof.roster_version_id,proof.decision,proof.editable_text)
    ||jsonb_build_object('template_id',proof.template_id,'template_version',proof.template_version,
      'template_content',proof.template_content);
  current_digest:=encode(extensions.digest(convert_to(current_payload::text,'UTF8'),'sha256'),'hex');
  if current_payload->>'outcome'<>'ok' or current_digest<>proof.render_digest or current_payload<>proof.payload_snapshot
    then return ('preview_conflict',null,0)::public.decision_message_batch_result; end if;
  select * into existing from public.communication_batches where organization_id=proof.organization_id and preview_digest=proof.render_digest;
  if found then
    insert into public.communication_preview_tombstones(token_digest,render_digest,binding_digest,communication_batch_id)
      values(proof.token_digest,proof.render_digest,binding_hash,existing.id);
    delete from public.communication_preview_proofs where token_digest=proof.token_digest;
    return ('replayed',existing.id,existing.recipient_count)::public.decision_message_batch_result;
  end if;
  insert into public.communication_batches(id,organization_id,roster_version_id,roster_version,decision,
    editable_text,preview_digest,recipient_count,created_by_user_id,template_id,template_version,template_content)
  values(new_batch,proof.organization_id,proof.roster_version_id,proof.roster_version,proof.decision,
    proof.editable_text,proof.render_digest,(current_payload->>'count')::integer,auth.uid(),
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
      auth.uid(),new_batch,facts,proof.tryout_id,proof.division_id,proof.template_id,proof.template_version);
    insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key)
    values(job_id,proof.organization_id,message_id,'decision-batch:'||new_batch||':'||(row->>'registration_id'),'communication:'||message_id);
    queued:=queued+1;
  end loop;
  insert into public.communication_preview_tombstones(token_digest,render_digest,binding_digest,communication_batch_id)
    values(proof.token_digest,proof.render_digest,binding_hash,new_batch);
  delete from public.communication_preview_proofs where token_digest=proof.token_digest;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(proof.organization_id,auth.uid(),'communication.batch_created','communication_batch',new_batch,
    jsonb_build_object('decision',proof.decision,'recipient_count',queued,'roster_version_id',proof.roster_version_id,
      'template_id',proof.template_id,'template_version',proof.template_version));
  return ('queued',new_batch,queued)::public.decision_message_batch_result;
end $$;

create or replace function public.save_communication_template(
  p_organization_id uuid,p_message_kind text,p_editable_text text,p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.communication_templates%rowtype; next_version bigint; saved_id uuid;
begin
  if auth.uid() is null or p_message_kind not in ('callback','selected','waitlisted','released')
    or char_length(trim(p_editable_text)) not between 1 and 4000 or p_expected_version not between 0 and 9007199254740990
    then return jsonb_build_object('outcome','invalid_input'); end if;
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    then return jsonb_build_object('outcome','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended('communication-template:'||p_organization_id::text||':'||p_message_kind,0));
  select * into existing from public.communication_templates where organization_id=p_organization_id and message_kind=p_message_kind for update;
  if found and existing.version<>p_expected_version then return jsonb_build_object('outcome','version_conflict','version',existing.version,'templateId',existing.id); end if;
  if not found and p_expected_version<>0 then return jsonb_build_object('outcome','version_conflict','version',0); end if;
  next_version:=p_expected_version+1;
  insert into public.communication_templates(organization_id,message_kind,editable_text,version,updated_by_user_id)
  values(p_organization_id,p_message_kind,trim(p_editable_text),next_version,auth.uid())
  on conflict(organization_id,message_kind) do update set editable_text=excluded.editable_text,
    version=excluded.version,updated_by_user_id=excluded.updated_by_user_id returning id into saved_id;
  return jsonb_build_object('outcome','saved','version',next_version,'templateId',saved_id,'editableText',trim(p_editable_text));
end $$;

alter table public.communication_pending_delivery_events add column organization_id uuid;
alter table public.communication_pending_delivery_events disable trigger prevent_pending_delivery_events_mutation;
update public.communication_pending_delivery_events pending set organization_id=message.organization_id
  from public.communication_messages message where message.id=pending.message_id;
alter table public.communication_pending_delivery_events enable always trigger prevent_pending_delivery_events_mutation;
alter table public.communication_pending_delivery_events alter column organization_id set not null;
alter table public.communication_pending_delivery_events add constraint communication_pending_events_message_fkey
  foreign key(organization_id,message_id) references public.communication_messages(organization_id,id) on delete restrict;
create index communication_pending_delivery_events_message_idx
  on public.communication_pending_delivery_events(organization_id,message_id,occurred_at,event_id);

create function private.bind_pending_delivery_event_organization() returns trigger
language plpgsql set search_path='' as $$
declare target_organization_id uuid;
begin
  select message.organization_id into target_organization_id from public.communication_messages message
    where message.id=new.message_id;
  if target_organization_id is null then raise exception 'unknown communication message' using errcode='23503'; end if;
  new.organization_id:=target_organization_id;
  return new;
end $$;
create trigger bind_pending_delivery_event_organization before insert on public.communication_pending_delivery_events
for each row execute function private.bind_pending_delivery_event_organization();

create trigger deny_pending_delivery_events_truncate before truncate on public.communication_pending_delivery_events
for each statement execute function private.prevent_communication_evidence_mutation();
alter table public.communication_pending_delivery_events enable always trigger deny_pending_delivery_events_truncate;
create trigger prevent_communication_preview_tombstones_mutation before update or delete on public.communication_preview_tombstones
for each row execute function private.prevent_communication_evidence_mutation();
create trigger deny_communication_preview_tombstones_truncate before truncate on public.communication_preview_tombstones
for each statement execute function private.prevent_communication_evidence_mutation();
alter table public.communication_preview_tombstones enable always trigger prevent_communication_preview_tombstones_mutation;
alter table public.communication_preview_tombstones enable always trigger deny_communication_preview_tombstones_truncate;

revoke all on function public.preview_decision_message_batch(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.preview_decision_message_batch_v2(uuid,uuid,text,text,text,bigint),
  public.list_communication_templates_for_notice(uuid,uuid),public.purge_expired_communication_previews(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.preview_decision_message_batch_v2(uuid,uuid,text,text,text,bigint),
  public.list_communication_templates_for_notice(uuid,uuid) to authenticated;
grant execute on function public.purge_expired_communication_previews(integer) to service_role;
revoke all on function private.purge_expired_communication_previews_for_tenant(uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function private.bind_pending_delivery_event_organization()
  from public,anon,authenticated,service_role;
