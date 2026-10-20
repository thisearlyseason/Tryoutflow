-- Task 23 review round 3: serialize exact preview-token confirmation before any authority lookup.

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

  -- This lock is always first. A 64-bit hash collision can only serialize unrelated capabilities;
  -- all authority and replay decisions still compare the complete SHA-256 token digest below.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'communication-preview-confirmation-v2:'||token_hash,0));

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
