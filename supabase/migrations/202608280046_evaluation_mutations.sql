-- Evaluation device mutations are committed with an immutable, actor-bound
-- receipt in the same transaction. No role receives direct table writes.

create table public.evaluation_mutations (
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  client_mutation_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evaluation_id uuid not null,
  expected_version integer not null,
  payload_digest text not null,
  outcome text not null,
  server_version integer,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_user_id,client_mutation_id),
  constraint evaluation_mutations_organization_id_actor_client_key
    unique (organization_id,actor_user_id,client_mutation_id),
  constraint evaluation_mutations_expected_version_check
    check (expected_version between 0 and 2147483646),
  constraint evaluation_mutations_payload_digest_check
    check (payload_digest ~ '^[0-9a-f]{64}$'),
  constraint evaluation_mutations_outcome_check check (
    outcome in ('synced','conflict','forbidden','invalid_context','invalid_score',
      'invalid_note_tag','invalid_rubric','locked')
  ),
  constraint evaluation_mutations_server_version_check check (
    (outcome='synced' and server_version=expected_version+1)
    or (outcome<>'synced' and (server_version is null or server_version>0))
  ),
  constraint evaluation_mutations_receipt_shape_check check (
    jsonb_typeof(receipt)='object'
    and receipt->>'outcome'=outcome
    and receipt->>'clientMutationId'=client_mutation_id::text
    and receipt->>'evaluationId'=evaluation_id::text
    and (receipt->>'expectedVersion')::integer=expected_version
    and receipt->>'payloadDigest'=payload_digest
    and ((server_version is null and receipt->'serverVersion'='null'::jsonb)
      or (receipt->>'serverVersion')::integer=server_version)
  )
);

create index evaluation_mutations_organization_evaluation_idx
  on public.evaluation_mutations(organization_id,evaluation_id,created_at);

alter table public.evaluation_mutations enable row level security;
revoke all on public.evaluation_mutations from anon,authenticated,service_role;

create function private.record_evaluation_mutation_receipt(
  p_actor_user_id uuid,p_client_mutation_id uuid,p_organization_id uuid,
  p_evaluation_id uuid,p_expected_version integer,p_payload_digest text,
  p_outcome text,p_server_version integer
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare recorded_at timestamptz:=clock_timestamp(); declare result jsonb;
begin
  result:=jsonb_build_object(
    'outcome',p_outcome,
    'clientMutationId',p_client_mutation_id,
    'evaluationId',p_evaluation_id,
    'expectedVersion',p_expected_version,
    'payloadDigest',p_payload_digest,
    'serverVersion',p_server_version,
    'acknowledgedAt',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
  insert into public.evaluation_mutations(
    actor_user_id,client_mutation_id,organization_id,evaluation_id,expected_version,
    payload_digest,outcome,server_version,receipt,created_at
  ) values (
    p_actor_user_id,p_client_mutation_id,p_organization_id,p_evaluation_id,p_expected_version,
    p_payload_digest,p_outcome,p_server_version,result,recorded_at
  );
  return result;
end;
$$;
revoke all on function private.record_evaluation_mutation_receipt(uuid,uuid,uuid,uuid,integer,text,text,integer)
  from public,anon,authenticated,service_role;

-- Match the Task 16 browser canonicalizer exactly: recursively sorted ASCII
-- object keys, preserved array order, and no insignificant whitespace.
create function private.canonical_evaluation_json(p_value jsonb) returns text
language sql immutable set search_path='' as $$
  select case jsonb_typeof(p_value)
    when 'object' then (
      select '{'||coalesce(string_agg(to_jsonb(item.key)::text||':'||private.canonical_evaluation_json(item.value),',' order by item.key collate "C"),'')||'}'
      from jsonb_each(p_value) item
    )
    when 'array' then (
      select '['||coalesce(string_agg(private.canonical_evaluation_json(item.value),',' order by item.ordinality),'')||']'
      from jsonb_array_elements(p_value) with ordinality item(value,ordinality)
    )
    else p_value::text
  end
$$;
revoke all on function private.canonical_evaluation_json(jsonb)
  from public,anon,authenticated,service_role;

create function public.sync_evaluation_mutation(
  p_organization_id uuid,p_tryout_id uuid,p_session_id uuid,p_registration_id uuid,
  p_rubric_version_id uuid,p_evaluation_id uuid,p_client_mutation_id uuid,
  p_expected_version integer,p_draft jsonb
) returns table(receipt jsonb)
language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid();
declare payload jsonb; declare payload_digest text; declare prior public.evaluation_mutations%rowtype;
declare division_id uuid; declare group_id uuid; declare target public.evaluations%rowtype;
declare score jsonb; declare score_category_id uuid; declare score_value integer;
declare category_ids uuid[]:=array[]::uuid[]; declare score_values integer[]:=array[]::integer[];
declare note_value text; declare tag_ids uuid[]; declare flag_values text[]; declare locked_tag_ids uuid[];
declare result jsonb;
begin
  if actor_id is null or p_organization_id is null or p_tryout_id is null or p_session_id is null
    or p_registration_id is null or p_rubric_version_id is null or p_evaluation_id is null
    or p_client_mutation_id is null or p_expected_version is null
    or p_expected_version not between 0 and 2147483646 or jsonb_typeof(p_draft)<>'object'
  then raise exception 'invalid evaluation mutation' using errcode='22023'; end if;

  payload:=jsonb_build_object(
    'scope',jsonb_build_object('userId',actor_id,'evaluatorId',actor_id,
      'organizationId',p_organization_id,'tryoutId',p_tryout_id,'sessionId',p_session_id,
      'registrationId',p_registration_id,'rubricVersionId',p_rubric_version_id),
    'evaluationId',p_evaluation_id,'expectedVersion',p_expected_version,'draft',p_draft
  );
  payload_digest:=encode(extensions.digest(private.canonical_evaluation_json(payload),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','evaluation-mutation',actor_id,p_client_mutation_id),0));
  select * into prior from public.evaluation_mutations m
    where m.actor_user_id=actor_id and m.client_mutation_id=p_client_mutation_id for update;
  if found then
    if prior.organization_id<>p_organization_id or prior.evaluation_id<>p_evaluation_id
      or prior.expected_version<>p_expected_version or prior.payload_digest<>payload_digest
    then raise exception 'client mutation id already binds another payload' using errcode='TF409'; end if;
    return query select prior.receipt; return;
  end if;

  -- Validate the strict allow-list before any domain write.
  if p_draft-array['scores','note','noteTagIds','flags']<>'{}'::jsonb
    or jsonb_typeof(p_draft->'scores')<>'array'
    or jsonb_typeof(p_draft->'noteTagIds')<>'array'
    or jsonb_typeof(p_draft->'flags')<>'array'
    or jsonb_array_length(p_draft->'scores')>50
    or jsonb_array_length(p_draft->'noteTagIds')>25
    or jsonb_array_length(p_draft->'flags')>3
    or (p_draft?'note' and jsonb_typeof(p_draft->'note')<>'string')
  then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'invalid_score',null);
    return query select result; return;
  end if;

  begin
    note_value:=case when p_draft?'note' then p_draft->>'note' else null end;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into tag_ids
      from jsonb_array_elements_text(p_draft->'noteTagIds');
    select coalesce(array_agg(value),'{}'::text[]) into flag_values
      from jsonb_array_elements_text(p_draft->'flags');
  exception when others then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'invalid_score',null);
    return query select result; return;
  end;

  select r.division_id,se.group_id into division_id,group_id
  from public.tryout_registrations r
  join public.session_enrollments se on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
    and se.registration_id=r.id and se.session_id=p_session_id
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id
  for share of r,se;
  if not found or not public.lock_evaluator_context(
    p_organization_id,p_tryout_id,division_id,p_registration_id,p_session_id,group_id,actor_id
  ) then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'forbidden',null);
    return query select result; return;
  end if;

  perform 1 from public.session_rubrics sr join public.rubric_versions rv
    on rv.organization_id=sr.organization_id and rv.tryout_id=sr.tryout_id and rv.id=sr.rubric_version_id
  where sr.organization_id=p_organization_id and sr.tryout_id=p_tryout_id
    and sr.session_id=p_session_id and sr.rubric_version_id=p_rubric_version_id and rv.status='published'
  for share of sr,rv;
  if not found then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'invalid_rubric',null);
    return query select result; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','evaluation',p_organization_id,p_registration_id,p_session_id,actor_id),0));
  select * into target from public.evaluations e
    where e.organization_id=p_organization_id and e.tryout_registration_id=p_registration_id
      and e.tryout_session_id=p_session_id and e.evaluator_user_id=actor_id for update;
  if found and (target.id<>p_evaluation_id or target.tryout_id<>p_tryout_id
    or target.division_id<>division_id or target.group_id is distinct from group_id
    or target.rubric_version_id<>p_rubric_version_id) then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'conflict',target.version);
    return query select result; return;
  end if;
  if found and target.state in ('completed','locked') then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'locked',target.version);
    return query select result; return;
  end if;
  if (found and target.version<>p_expected_version) or (not found and p_expected_version<>0) then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'conflict',case when found then target.version else null end);
    return query select result; return;
  end if;

  if (note_value is not null and char_length(note_value)>4000)
    or cardinality(tag_ids)<>cardinality(array(select distinct x from unnest(tag_ids) x))
    or cardinality(flag_values)<>cardinality(array(select distinct x from unnest(flag_values) x))
    or exists(select 1 from unnest(flag_values) x where x not in ('needs_another_look','injury_concern','eligibility_review'))
  then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'invalid_score',null);
    return query select result; return;
  end if;
  select coalesce(array_agg(t.id order by t.id),'{}'::uuid[]) into locked_tag_ids
  from (select configured.id from public.organization_evaluation_note_tags configured
    where configured.organization_id=p_organization_id and configured.id=any(tag_ids)
    order by configured.id for key share) t;
  if cardinality(locked_tag_ids)<>cardinality(tag_ids)
    or exists(select 1 from public.organization_evaluation_note_tags t where t.id=any(locked_tag_ids) and not t.active)
  then
    result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
      p_evaluation_id,p_expected_version,payload_digest,'invalid_note_tag',null);
    return query select result; return;
  end if;
  for score in select value from jsonb_array_elements(p_draft->'scores') loop
    begin
      if jsonb_typeof(score)<>'object' or score-array['categoryId','value']<>'{}'::jsonb
        or jsonb_typeof(score->'categoryId')<>'string' or jsonb_typeof(score->'value')<>'number'
        or (score->>'value') !~ '^[0-9]+$' then raise invalid_parameter_value; end if;
      score_category_id:=(score->>'categoryId')::uuid; score_value:=(score->>'value')::integer;
      if score_category_id=any(category_ids) or not exists(
        select 1 from public.rubric_categories c where c.organization_id=p_organization_id
          and c.tryout_id=p_tryout_id and c.rubric_version_id=p_rubric_version_id
          and c.id=score_category_id and score_value between c.scale_min and c.scale_max
      ) then raise invalid_parameter_value; end if;
      category_ids:=array_append(category_ids,score_category_id);
      score_values:=array_append(score_values,score_value);
    exception when others then
      result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
        p_evaluation_id,p_expected_version,payload_digest,'invalid_score',null);
      return query select result; return;
    end;
  end loop;

  if target.id is null then
    perform private.permit_evaluation_write(p_evaluation_id,'save');
    insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,
      tryout_session_id,group_id,evaluator_user_id,rubric_version_id)
    values(p_evaluation_id,p_organization_id,p_tryout_id,division_id,p_registration_id,
      p_session_id,group_id,actor_id,p_rubric_version_id) returning * into target;
  else
    perform private.permit_evaluation_write(target.id,'save');
    update public.evaluations e set version=e.version+1,updated_at=clock_timestamp()
      where e.id=target.id returning * into target;
  end if;
  delete from public.evaluation_scores s where s.organization_id=p_organization_id and s.evaluation_id=target.id;
  insert into public.evaluation_scores(organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value)
    select p_organization_id,p_tryout_id,target.id,p_rubric_version_id,c.category_id,v.score_value
    from unnest(category_ids) with ordinality c(category_id,ordinality)
    join unnest(score_values) with ordinality v(score_value,ordinality) using(ordinality);
  delete from public.evaluation_notes n where n.organization_id=p_organization_id and n.evaluation_id=target.id;
  if note_value is not null and note_value<>'' then
    insert into public.evaluation_notes(organization_id,evaluation_id,evaluator_user_id,note)
      values(p_organization_id,target.id,actor_id,note_value);
  end if;
  delete from public.evaluation_note_tags t where t.organization_id=p_organization_id and t.evaluation_id=target.id;
  insert into public.evaluation_note_tags(organization_id,evaluation_id,note_tag_id,evaluator_user_id)
    select p_organization_id,target.id,x,actor_id from unnest(tag_ids) x;
  delete from public.athlete_flags f where f.organization_id=p_organization_id and f.evaluation_id=target.id;
  insert into public.athlete_flags(organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,group_id,
    evaluation_id,evaluator_user_id,creator_user_id,creator_kind,flag_type)
    select p_organization_id,p_tryout_id,division_id,p_registration_id,p_session_id,group_id,
      target.id,actor_id,actor_id,'evaluator',x from unnest(flag_values) x;
  delete from private.evaluation_write_permits p where p.transaction_id=txid_current() and p.evaluation_id=target.id;

  result:=private.record_evaluation_mutation_receipt(actor_id,p_client_mutation_id,p_organization_id,
    p_evaluation_id,p_expected_version,payload_digest,'synced',target.version);
  return query select result;
end;
$$;

revoke all on function public.sync_evaluation_mutation(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  from public,anon,service_role;
grant execute on function public.sync_evaluation_mutation(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)
  to authenticated;
