-- Harden evaluation lifecycle writes, snapshot the authoritative placement,
-- serialize tag selection/configuration, and support privacy-preserving director flags.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

alter table public.evaluations
  add column division_id uuid,
  add column group_id uuid;
update public.evaluations e
set division_id=r.division_id,group_id=se.group_id
from public.tryout_registrations r
join public.session_enrollments se
  on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
 and se.registration_id=r.id
where r.organization_id=e.organization_id and r.tryout_id=e.tryout_id
  and r.id=e.tryout_registration_id and se.session_id=e.tryout_session_id;
alter table public.evaluations
  alter column division_id set not null,
  add constraint evaluations_division_fkey
    foreign key(organization_id,tryout_id,division_id)
    references public.tryout_divisions(organization_id,tryout_id,id) on delete restrict,
  add constraint evaluations_session_division_fkey
    foreign key(organization_id,tryout_id,division_id,tryout_session_id)
    references public.tryout_sessions(organization_id,tryout_id,division_id,id) on delete restrict,
  add constraint evaluations_group_context_fkey
    foreign key(organization_id,tryout_id,division_id,tryout_session_id,group_id)
    references public.session_groups(organization_id,tryout_id,division_id,session_id,id) on delete restrict;

alter table public.organization_evaluation_note_tags
  add constraint organization_evaluation_note_tags_canonical_label_check
  check(label=btrim(label) and char_length(label) between 1 and 80) not valid;
update public.organization_evaluation_note_tags set label=btrim(label) where label<>btrim(label);
alter table public.organization_evaluation_note_tags
  validate constraint organization_evaluation_note_tags_canonical_label_check;

alter table public.athlete_flags
  alter column evaluation_id drop not null,
  alter column evaluator_user_id drop not null,
  add column tryout_id uuid,
  add column division_id uuid,
  add column tryout_registration_id uuid,
  add column tryout_session_id uuid,
  add column group_id uuid,
  add column creator_user_id uuid references auth.users(id) on delete restrict,
  add column creator_kind text,
  add column revoked_at timestamptz,
  add column updated_at timestamptz not null default clock_timestamp();
update public.athlete_flags f
set tryout_id=e.tryout_id,division_id=e.division_id,tryout_registration_id=e.tryout_registration_id,
    tryout_session_id=e.tryout_session_id,group_id=e.group_id,
    creator_user_id=e.evaluator_user_id,creator_kind='evaluator'
from public.evaluations e
where e.organization_id=f.organization_id and e.id=f.evaluation_id;
alter table public.athlete_flags
  alter column tryout_id set not null,
  alter column division_id set not null,
  alter column tryout_registration_id set not null,
  alter column tryout_session_id set not null,
  alter column creator_user_id set not null,
  alter column creator_kind set not null,
  add constraint athlete_flags_creator_kind_check check(creator_kind in ('evaluator','director')),
  add constraint athlete_flags_ownership_shape_check check(
    (creator_kind='evaluator' and evaluation_id is not null and evaluator_user_id=creator_user_id and revoked_at is null)
    or (creator_kind='director' and evaluation_id is null and evaluator_user_id is null)
  ),
  add constraint athlete_flags_registration_context_fkey
    foreign key(organization_id,tryout_id,tryout_registration_id)
    references public.tryout_registrations(organization_id,tryout_id,id) on delete restrict,
  add constraint athlete_flags_session_context_fkey
    foreign key(organization_id,tryout_id,tryout_registration_id,tryout_session_id)
    references public.session_enrollments(organization_id,tryout_id,registration_id,session_id) on delete restrict,
  add constraint athlete_flags_division_context_fkey
    foreign key(organization_id,tryout_id,division_id)
    references public.tryout_divisions(organization_id,tryout_id,id) on delete restrict,
  add constraint athlete_flags_group_context_fkey
    foreign key(organization_id,tryout_id,division_id,tryout_session_id,group_id)
    references public.session_groups(organization_id,tryout_id,division_id,session_id,id) on delete restrict;
create unique index athlete_flags_active_director_key
  on public.athlete_flags(organization_id,tryout_registration_id,tryout_session_id,creator_user_id,flag_type)
  where creator_kind='director' and revoked_at is null;
create trigger set_athlete_flags_updated_at before update on public.athlete_flags
  for each row execute function public.set_updated_at();

create table private.evaluation_write_permits (
  transaction_id bigint not null,
  evaluation_id uuid not null,
  operation text not null check(operation in ('save','complete','lock','reopen')),
  primary key(transaction_id,evaluation_id)
);
revoke all on private.evaluation_write_permits from public,anon,authenticated,service_role;

create function private.permit_evaluation_write(p_evaluation_id uuid,p_operation text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_operation not in ('save','complete','lock','reopen') then
    raise exception 'invalid evaluation write permit' using errcode='22023';
  end if;
  insert into private.evaluation_write_permits(transaction_id,evaluation_id,operation)
  values(txid_current(),p_evaluation_id,p_operation)
  on conflict(transaction_id,evaluation_id) do update set operation=excluded.operation;
end;
$$;
revoke all on function private.permit_evaluation_write(uuid,text) from public,anon,authenticated,service_role;

drop trigger set_evaluations_updated_at on public.evaluations;
create function private.protect_evaluation_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare permitted_operation text;
declare target_id uuid:=coalesce(new.id,old.id);
begin
  select p.operation into permitted_operation
  from private.evaluation_write_permits p
  where p.transaction_id=txid_current() and p.evaluation_id=target_id;
  if permitted_operation is null then
    raise exception 'evaluation writes require trusted command' using errcode='P0001';
  end if;
  if tg_op='DELETE' then
    raise exception 'evaluation writes require trusted command' using errcode='P0001';
  end if;
  if tg_op='INSERT' then
    if permitted_operation<>'save' or new.state<>'draft' or new.version<>1
      or new.completed_at is not null or new.reopened_at is not null
      or new.reopened_by_user_id is not null or new.reopen_reason is not null
    then raise exception 'invalid evaluation transition' using errcode='55000'; end if;
    return new;
  end if;
  if row(old.id,old.organization_id,old.tryout_id,old.division_id,old.tryout_registration_id,
      old.tryout_session_id,old.group_id,old.evaluator_user_id,old.rubric_version_id,old.created_at)
    is distinct from
    row(new.id,new.organization_id,new.tryout_id,new.division_id,new.tryout_registration_id,
      new.tryout_session_id,new.group_id,new.evaluator_user_id,new.rubric_version_id,new.created_at)
  then raise exception 'immutable evaluation identity or context' using errcode='55000'; end if;
  if new.version<>old.version+1 or new.updated_at<=old.updated_at then
    raise exception 'invalid evaluation version or timestamp' using errcode='55000';
  end if;
  if permitted_operation='save' then
    if old.state not in ('draft','reopened') or new.state<>old.state
      or new.completed_at is distinct from old.completed_at
      or new.reopened_at is distinct from old.reopened_at
      or new.reopened_by_user_id is distinct from old.reopened_by_user_id
      or new.reopen_reason is distinct from old.reopen_reason
    then raise exception 'invalid evaluation save transition' using errcode='55000'; end if;
  elsif permitted_operation='complete' then
    if old.state not in ('draft','reopened') or new.state<>'completed'
      or old.completed_at is not null or new.completed_at is null
      or new.reopened_at is distinct from old.reopened_at
      or new.reopened_by_user_id is distinct from old.reopened_by_user_id
      or new.reopen_reason is distinct from old.reopen_reason
    then raise exception 'invalid evaluation completion transition' using errcode='55000'; end if;
  elsif permitted_operation='lock' then
    if old.state<>'completed' or new.state<>'locked'
      or new.completed_at is distinct from old.completed_at
      or new.reopened_at is distinct from old.reopened_at
      or new.reopened_by_user_id is distinct from old.reopened_by_user_id
      or new.reopen_reason is distinct from old.reopen_reason
    then raise exception 'invalid evaluation lock transition' using errcode='55000'; end if;
  elsif permitted_operation='reopen' then
    if old.state not in ('completed','locked') or new.state<>'reopened'
      or new.completed_at is not null or new.reopened_at is null
      or new.reopened_by_user_id is null
      or char_length(btrim(new.reopen_reason)) not between 10 and 500
    then raise exception 'invalid evaluation reopen transition' using errcode='55000'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_evaluation_write() from public,anon,authenticated,service_role;
create trigger protect_evaluation_write before insert or update or delete on public.evaluations
  for each row execute function private.protect_evaluation_write();

create or replace function public.assert_valid_evaluation_score()
returns trigger language plpgsql security definer set search_path='' as $$
declare category public.rubric_categories%rowtype;
begin
  select * into category from public.rubric_categories c
  where c.organization_id=new.organization_id and c.tryout_id=new.tryout_id
    and c.rubric_version_id=new.rubric_version_id and c.id=new.rubric_category_id;
  if not found or new.value not between category.scale_min and category.scale_max
  then raise exception 'invalid evaluation score' using errcode='23514'; end if;
  return new;
end;
$$;

create function private.protect_evaluation_child_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent_state text;
declare parent_id uuid:=case when tg_op='DELETE' then old.evaluation_id else new.evaluation_id end;
declare parent_organization_id uuid:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
begin
  if tg_table_name='athlete_flags' and
    (case when tg_op='DELETE' then to_jsonb(old)->>'creator_kind' else to_jsonb(new)->>'creator_kind' end)='director'
  then return case when tg_op='DELETE' then old else new end; end if;
  select e.state into parent_state from public.evaluations e
  where e.organization_id=parent_organization_id and e.id=parent_id for update;
  if not found then return case when tg_op='DELETE' then old else new end; end if;
  if parent_state not in ('draft','reopened') then
    raise exception 'completed evaluation children are immutable' using errcode='55000';
  end if;
  if tg_op='UPDATE' and row(old.organization_id,old.evaluation_id) is distinct from row(new.organization_id,new.evaluation_id) then
    raise exception 'evaluation child identity is immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.protect_evaluation_child_write() from public,anon,authenticated,service_role;
create trigger protect_evaluation_score_write before insert or update or delete on public.evaluation_scores
  for each row execute function private.protect_evaluation_child_write();
create trigger protect_evaluation_note_write before insert or update or delete on public.evaluation_notes
  for each row execute function private.protect_evaluation_child_write();
create trigger protect_evaluation_note_tag_write before insert or update or delete on public.evaluation_note_tags
  for each row execute function private.protect_evaluation_child_write();
create trigger protect_evaluation_flag_write before insert or update or delete on public.athlete_flags
  for each row execute function private.protect_evaluation_child_write();

create function public.lock_evaluator_context(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid,p_evaluator_user_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_evaluator_user_id<>auth.uid() then return false; end if;
  perform 1 from public.organizations o where o.id=p_organization_id for key share;
  if not found then return false; end if;
  perform 1 from auth.users u where u.id=p_evaluator_user_id for key share;
  if not found then return false; end if;
  perform 1 from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=p_evaluator_user_id and m.status='active' for share;
  if not found then return false; end if;
  perform 1 from public.tryout_registrations r
  join public.session_enrollments se on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
    and se.registration_id=r.id and se.session_id=p_session_id
  join public.tryouts t on t.organization_id=r.organization_id and t.id=r.tryout_id
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id
    and r.division_id=p_division_id and se.group_id is not distinct from p_group_id
    and r.status='submitted' and t.status in ('published','finalized')
  for share of r,se,t;
  if not found then return false; end if;
  perform 1 from public.tryout_staff_assignments a
  where a.organization_id=p_organization_id and a.user_id=p_evaluator_user_id
    and a.role='evaluator' and a.tryout_id=p_tryout_id and a.revoked_at is null
    and (a.expires_at is null or a.expires_at>clock_timestamp())
    and (a.scope_kind='tryout' or (a.scope_kind='division' and a.division_id=p_division_id)
      or (a.scope_kind='session' and a.session_id=p_session_id)
      or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=p_group_id))
  order by a.id for share;
  return found;
end;
$$;

create function public.lock_manager_evaluation_context(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid();
declare actor_role text;
begin
  if actor_id is null then return false; end if;
  perform 1 from public.organizations o where o.id=p_organization_id for key share;
  if not found then return false; end if;
  perform 1 from auth.users u where u.id=actor_id for key share;
  if not found then return false; end if;
  select m.role into actor_role from public.organization_members m
  where m.organization_id=p_organization_id and m.user_id=actor_id and m.status='active' for share;
  if not found then return false; end if;
  perform 1 from public.tryout_registrations r
  join public.session_enrollments se on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
    and se.registration_id=r.id and se.session_id=p_session_id
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id
    and r.division_id=p_division_id and se.group_id is not distinct from p_group_id
  for share of r,se;
  if not found then return false; end if;
  if actor_role in ('owner','administrator') then return true; end if;
  perform 1 from public.tryout_staff_assignments a
  where a.organization_id=p_organization_id and a.user_id=actor_id and a.role='director'
    and a.tryout_id=p_tryout_id and a.revoked_at is null
    and (a.expires_at is null or a.expires_at>clock_timestamp())
    and (a.scope_kind='tryout' or (a.scope_kind='division' and a.division_id=p_division_id)
      or (a.scope_kind='session' and a.session_id=p_session_id)
      or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=p_group_id))
  order by a.id for share;
  return found;
end;
$$;

create function public.manager_has_evaluation_context(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or exists(
      select 1 from public.tryout_registrations r
      join public.session_enrollments se on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
        and se.registration_id=r.id and se.session_id=p_session_id
      join public.organization_members m on m.organization_id=r.organization_id and m.user_id=auth.uid() and m.status='active'
      join public.tryout_staff_assignments a on a.organization_id=r.organization_id and a.user_id=m.user_id
        and a.role='director' and a.tryout_id=r.tryout_id and a.revoked_at is null
        and (a.expires_at is null or a.expires_at>clock_timestamp())
        and (a.scope_kind='tryout' or (a.scope_kind='division' and a.division_id=p_division_id)
          or (a.scope_kind='session' and a.session_id=p_session_id)
          or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=p_group_id))
      where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id
        and r.division_id=p_division_id and se.group_id is not distinct from p_group_id
    );
$$;

create or replace function public.configure_evaluation_note_tag(
  p_organization_id uuid,p_note_tag_id uuid,p_label text,p_active boolean
) returns table(outcome text,note_tag_id uuid)
language plpgsql security definer set search_path='' as $$
declare saved_id uuid;
declare actor_id uuid:=auth.uid();
declare actor_role text;
begin
  if actor_id is null then return query select 'forbidden',null::uuid; return; end if;
  perform 1 from public.organizations o where o.id=p_organization_id for key share;
  perform 1 from auth.users u where u.id=actor_id for key share;
  select m.role into actor_role from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=actor_id and m.status='active' for share;
  if not found or actor_role not in ('owner','administrator')
  then return query select 'forbidden',null::uuid; return; end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 80 or p_active is null
  then return query select 'invalid_tag',null::uuid; return; end if;
  begin
    if p_note_tag_id is null then
      insert into public.organization_evaluation_note_tags(organization_id,label,active)
      values(p_organization_id,btrim(p_label),p_active) returning id into saved_id;
    else
      select t.id into saved_id from public.organization_evaluation_note_tags t
        where t.organization_id=p_organization_id and t.id=p_note_tag_id for update;
      if not found then return query select 'invalid_tag',null::uuid; return; end if;
      update public.organization_evaluation_note_tags t set label=btrim(p_label),active=p_active where t.id=saved_id;
    end if;
  exception when unique_violation then
    return query select 'conflict',null::uuid; return;
  end;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,actor_id,'evaluation.note_tag_configured','evaluation_note_tag',saved_id,
    jsonb_build_object('active',p_active));
  return query select 'saved',saved_id;
end;
$$;

create function public.save_evaluation_draft(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid,p_rubric_version_id uuid,p_expected_version integer,
  p_scores jsonb,p_note text default null,p_note_tag_ids uuid[] default array[]::uuid[],
  p_flags text[] default array[]::text[]
) returns table(outcome text,evaluation_id uuid,version integer)
language plpgsql security definer set search_path='' as $$
declare current_evaluation public.evaluations%rowtype;
declare score jsonb; declare score_category_id uuid; declare score_value integer;
declare current_user_id uuid:=auth.uid(); declare new_evaluation_id uuid;
declare validated_category_ids uuid[]:=array[]::uuid[]; declare validated_values integer[]:=array[]::integer[];
declare locked_tag_ids uuid[];
begin
  if current_user_id is null or not public.lock_evaluator_context(
    p_organization_id,p_tryout_id,p_division_id,p_registration_id,p_session_id,p_group_id,current_user_id
  ) then return query select 'forbidden',null::uuid,null::integer; return; end if;
  if p_expected_version is null or p_expected_version<0 then
    return query select 'invalid_context',null::uuid,null::integer; return; end if;
  perform 1 from public.session_rubrics sr join public.rubric_versions rv
    on rv.organization_id=sr.organization_id and rv.tryout_id=sr.tryout_id and rv.id=sr.rubric_version_id
  where sr.organization_id=p_organization_id and sr.tryout_id=p_tryout_id
    and sr.session_id=p_session_id and sr.rubric_version_id=p_rubric_version_id and rv.status='published'
  for share of sr,rv;
  if not found then return query select 'invalid_context',null::uuid,null::integer; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','evaluation',p_organization_id,p_registration_id,p_session_id,current_user_id),0));
  select * into current_evaluation from public.evaluations e
  where e.organization_id=p_organization_id and e.tryout_registration_id=p_registration_id
    and e.tryout_session_id=p_session_id and e.evaluator_user_id=current_user_id for update;
  if found then
    if current_evaluation.tryout_id<>p_tryout_id or current_evaluation.division_id<>p_division_id
      or current_evaluation.group_id is distinct from p_group_id or current_evaluation.rubric_version_id<>p_rubric_version_id
    then return query select 'invalid_context',null::uuid,null::integer; return; end if;
    if current_evaluation.state in ('completed','locked') then
      return query select 'locked',current_evaluation.id,current_evaluation.version; return; end if;
    if current_evaluation.version<>p_expected_version then
      return query select 'conflict',current_evaluation.id,current_evaluation.version; return; end if;
  elsif p_expected_version<>0 then return query select 'conflict',null::uuid,null::integer; return; end if;
  if jsonb_typeof(p_scores)<>'array' or jsonb_array_length(p_scores)>100
    or coalesce(cardinality(p_note_tag_ids),0)>50 or coalesce(cardinality(p_flags),0)>20
    or (p_note is not null and char_length(btrim(p_note)) not between 1 and 4000)
    or cardinality(p_note_tag_ids)<>cardinality(array(select distinct x from unnest(p_note_tag_ids) x))
    or cardinality(p_flags)<>cardinality(array(select distinct x from unnest(p_flags) x))
    or exists(select 1 from unnest(p_flags) x where x not in ('needs_another_look','injury_concern','eligibility_review'))
  then return query select 'invalid_score',current_evaluation.id,current_evaluation.version; return; end if;
  select coalesce(array_agg(t.id order by t.id),'{}'::uuid[]) into locked_tag_ids
  from (select configured.id from public.organization_evaluation_note_tags configured
        where configured.organization_id=p_organization_id and configured.id=any(p_note_tag_ids)
        order by configured.id for key share) t;
  if cardinality(locked_tag_ids)<>coalesce(cardinality(p_note_tag_ids),0)
    or exists(select 1 from public.organization_evaluation_note_tags t where t.id=any(locked_tag_ids) and not t.active)
  then return query select 'invalid_note_tag',current_evaluation.id,current_evaluation.version; return; end if;
  for score in select value from jsonb_array_elements(p_scores) loop
    begin
      if jsonb_typeof(score)<>'object' or score-array['categoryId','value']<>'{}'::jsonb
        or jsonb_typeof(score->'categoryId')<>'string' or jsonb_typeof(score->'value')<>'number'
        or (score->>'value') !~ '^-?[0-9]+$' then raise invalid_parameter_value; end if;
      score_category_id:=(score->>'categoryId')::uuid; score_value:=(score->>'value')::integer;
      if score_category_id=any(validated_category_ids) or not exists(
        select 1 from public.rubric_categories c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id
          and c.rubric_version_id=p_rubric_version_id and c.id=score_category_id
          and score_value between c.scale_min and c.scale_max
      ) then raise invalid_parameter_value; end if;
      validated_category_ids:=array_append(validated_category_ids,score_category_id);
      validated_values:=array_append(validated_values,score_value);
    exception when others then
      return query select 'invalid_score',current_evaluation.id,current_evaluation.version; return;
    end;
  end loop;
  if current_evaluation.id is null then
    new_evaluation_id:=gen_random_uuid(); perform private.permit_evaluation_write(new_evaluation_id,'save');
    insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,
      tryout_session_id,group_id,evaluator_user_id,rubric_version_id)
    values(new_evaluation_id,p_organization_id,p_tryout_id,p_division_id,p_registration_id,
      p_session_id,p_group_id,current_user_id,p_rubric_version_id) returning * into current_evaluation;
  else
    perform private.permit_evaluation_write(current_evaluation.id,'save');
    update public.evaluations e set version=e.version+1,updated_at=clock_timestamp()
      where e.id=current_evaluation.id returning * into current_evaluation;
  end if;
  delete from public.evaluation_scores s where s.organization_id=p_organization_id and s.evaluation_id=current_evaluation.id;
  insert into public.evaluation_scores(organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value)
    select p_organization_id,p_tryout_id,current_evaluation.id,p_rubric_version_id,c.category_id,v.score_value
    from unnest(validated_category_ids) with ordinality c(category_id,ordinality)
    join unnest(validated_values) with ordinality v(score_value,ordinality) using(ordinality);
  delete from public.evaluation_notes n where n.organization_id=p_organization_id and n.evaluation_id=current_evaluation.id;
  if p_note is not null then insert into public.evaluation_notes(organization_id,evaluation_id,evaluator_user_id,note)
    values(p_organization_id,current_evaluation.id,current_user_id,btrim(p_note)); end if;
  delete from public.evaluation_note_tags t where t.organization_id=p_organization_id and t.evaluation_id=current_evaluation.id;
  insert into public.evaluation_note_tags(organization_id,evaluation_id,note_tag_id,evaluator_user_id)
    select p_organization_id,current_evaluation.id,x,current_user_id from unnest(p_note_tag_ids) x;
  delete from public.athlete_flags f where f.organization_id=p_organization_id and f.evaluation_id=current_evaluation.id;
  insert into public.athlete_flags(organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,group_id,
    evaluation_id,evaluator_user_id,creator_user_id,creator_kind,flag_type)
    select p_organization_id,p_tryout_id,p_division_id,p_registration_id,p_session_id,p_group_id,
      current_evaluation.id,current_user_id,current_user_id,'evaluator',x from unnest(p_flags) x;
  delete from private.evaluation_write_permits p where p.transaction_id=txid_current() and p.evaluation_id=current_evaluation.id;
  return query select 'saved',current_evaluation.id,current_evaluation.version;
end;
$$;

create function public.complete_evaluation(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_session_id uuid,p_group_id uuid,
  p_evaluation_id uuid,p_expected_version integer
) returns table(outcome text,version integer)
language plpgsql security definer set search_path='' as $$
declare target public.evaluations%rowtype;
begin
  select * into target from public.evaluations e where e.organization_id=p_organization_id and e.id=p_evaluation_id;
  if not found or target.tryout_id<>p_tryout_id or target.division_id<>p_division_id
    or target.tryout_session_id<>p_session_id or target.group_id is distinct from p_group_id
    or target.evaluator_user_id<>auth.uid() or not public.lock_evaluator_context(
      target.organization_id,target.tryout_id,target.division_id,target.tryout_registration_id,
      target.tryout_session_id,target.group_id,target.evaluator_user_id)
  then return query select 'forbidden',null::integer; return; end if;
  select * into target from public.evaluations e where e.id=p_evaluation_id for update;
  if p_expected_version is null or target.version<>p_expected_version then return query select 'conflict',target.version; return; end if;
  if target.state in ('completed','locked') then return query select 'locked',target.version; return; end if;
  if exists(select 1 from public.rubric_categories c where c.organization_id=target.organization_id
    and c.tryout_id=target.tryout_id and c.rubric_version_id=target.rubric_version_id
    and not exists(select 1 from public.evaluation_scores s where s.organization_id=target.organization_id
      and s.evaluation_id=target.id and s.rubric_category_id=c.id))
  then return query select 'required_scores_missing',target.version; return; end if;
  perform private.permit_evaluation_write(target.id,'complete');
  update public.evaluations e set state='completed',version=e.version+1,
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
  where e.id=target.id returning e.version into target.version;
  delete from private.evaluation_write_permits p where p.transaction_id=txid_current() and p.evaluation_id=target.id;
  return query select 'completed',target.version;
end;
$$;

create function public.lock_evaluation(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_session_id uuid,p_group_id uuid,
  p_evaluation_id uuid,p_expected_version integer
) returns table(outcome text,version integer)
language plpgsql security definer set search_path='' as $$
declare target public.evaluations%rowtype; declare before_version integer;
begin
  select * into target from public.evaluations e where e.organization_id=p_organization_id and e.id=p_evaluation_id;
  if not found or target.tryout_id<>p_tryout_id or target.division_id<>p_division_id
    or target.tryout_session_id<>p_session_id or target.group_id is distinct from p_group_id
    or not public.lock_manager_evaluation_context(target.organization_id,target.tryout_id,target.division_id,
      target.tryout_registration_id,target.tryout_session_id,target.group_id)
  then return query select 'forbidden',null::integer; return; end if;
  select * into target from public.evaluations e where e.id=p_evaluation_id for update;
  if p_expected_version is null or target.version<>p_expected_version then return query select 'conflict',target.version; return; end if;
  if target.state<>'completed' then return query select 'invalid_state',target.version; return; end if;
  before_version:=target.version; perform private.permit_evaluation_write(target.id,'lock');
  update public.evaluations e set state='locked',version=e.version+1,updated_at=clock_timestamp()
    where e.id=target.id returning e.version into target.version;
  delete from private.evaluation_write_permits p where p.transaction_id=txid_current() and p.evaluation_id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(target.organization_id,auth.uid(),'evaluation.locked','evaluation',target.id,
    jsonb_build_object('beforeState','completed','afterState','locked','beforeVersion',before_version,'afterVersion',target.version));
  return query select 'locked',target.version;
end;
$$;

create function public.reopen_evaluation(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_session_id uuid,p_group_id uuid,
  p_evaluation_id uuid,p_expected_version integer,p_reason text
) returns table(outcome text,version integer)
language plpgsql security definer set search_path='' as $$
declare target public.evaluations%rowtype; declare before_version integer;
begin
  select * into target from public.evaluations e where e.organization_id=p_organization_id and e.id=p_evaluation_id;
  if not found or target.tryout_id<>p_tryout_id or target.division_id<>p_division_id
    or target.tryout_session_id<>p_session_id or target.group_id is distinct from p_group_id
    or not public.lock_manager_evaluation_context(target.organization_id,target.tryout_id,target.division_id,
      target.tryout_registration_id,target.tryout_session_id,target.group_id)
  then return query select 'forbidden',null::integer; return; end if;
  select * into target from public.evaluations e where e.id=p_evaluation_id for update;
  if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500
  then return query select 'invalid_reason',target.version; return; end if;
  if p_expected_version is null or target.version<>p_expected_version then return query select 'conflict',target.version; return; end if;
  if target.state not in ('completed','locked') then return query select 'invalid_state',target.version; return; end if;
  before_version:=target.version; perform private.permit_evaluation_write(target.id,'reopen');
  update public.evaluations e set state='reopened',version=e.version+1,completed_at=null,
    reopened_at=clock_timestamp(),reopened_by_user_id=auth.uid(),reopen_reason=btrim(p_reason),updated_at=clock_timestamp()
  where e.id=target.id returning e.version into target.version;
  delete from private.evaluation_write_permits p where p.transaction_id=txid_current() and p.evaluation_id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(target.organization_id,auth.uid(),'evaluation.reopened','evaluation',target.id,
    jsonb_build_object('reason',btrim(p_reason),'beforeState',target.state,'afterState','reopened','beforeVersion',before_version,'afterVersion',target.version));
  return query select 'reopened',target.version;
end;
$$;

create function public.manage_director_evaluation_flag(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid,p_flag_id uuid,p_action text,p_flag_type text
) returns table(outcome text,athlete_flag_id uuid)
language plpgsql security definer set search_path='' as $$
declare target public.athlete_flags%rowtype; declare saved_id uuid; declare actor_id uuid:=auth.uid();
begin
  if p_action not in ('upsert','revoke') or p_flag_type not in ('needs_another_look','injury_concern','eligibility_review')
  then return query select 'invalid_flag',null::uuid; return; end if;
  if not public.lock_manager_evaluation_context(p_organization_id,p_tryout_id,p_division_id,p_registration_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid; return; end if;
  if p_flag_id is not null then
    select * into target from public.athlete_flags f where f.organization_id=p_organization_id and f.id=p_flag_id for update;
    if not found or target.creator_kind<>'director'
      or target.tryout_id<>p_tryout_id or target.division_id<>p_division_id
      or target.tryout_registration_id<>p_registration_id or target.tryout_session_id<>p_session_id
      or target.group_id is distinct from p_group_id
    then return query select 'forbidden',null::uuid; return; end if;
  end if;
  if p_action='revoke' then
    if p_flag_id is null or target.revoked_at is not null then return query select 'invalid_flag',null::uuid; return; end if;
    update public.athlete_flags set revoked_at=clock_timestamp() where id=target.id returning id into saved_id;
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_organization_id,actor_id,'evaluation.director_flag_revoked','athlete_flag',saved_id,
      jsonb_build_object('flagType',target.flag_type,'registrationId',p_registration_id,'sessionId',p_session_id));
    return query select 'revoked',saved_id; return;
  end if;
  if p_flag_id is null then
    begin
      insert into public.athlete_flags(organization_id,tryout_id,division_id,tryout_registration_id,
        tryout_session_id,group_id,creator_user_id,creator_kind,flag_type)
      values(p_organization_id,p_tryout_id,p_division_id,p_registration_id,p_session_id,p_group_id,
        actor_id,'director',p_flag_type) returning id into saved_id;
    exception when unique_violation then return query select 'conflict',null::uuid; return; end;
  else
    if target.revoked_at is not null then return query select 'invalid_flag',null::uuid; return; end if;
    begin
      update public.athlete_flags set flag_type=p_flag_type where id=target.id returning id into saved_id;
    exception when unique_violation then return query select 'conflict',null::uuid; return; end;
  end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,actor_id,'evaluation.director_flag_saved','athlete_flag',saved_id,
    jsonb_build_object('flagType',p_flag_type,'registrationId',p_registration_id,'sessionId',p_session_id));
  return query select 'saved',saved_id;
end;
$$;

create function public.can_select_director_flag(p_flag_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.athlete_flags f where f.id=p_flag_id and f.creator_kind='director'
    and f.revoked_at is null and public.manager_has_evaluation_context(f.organization_id,f.tryout_id,f.division_id,
      f.tryout_registration_id,f.tryout_session_id,f.group_id));
$$;
create policy athlete_flags_director_context_select on public.athlete_flags for select to authenticated
  using(public.can_select_director_flag(id));

revoke execute on function public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[]) from authenticated;
revoke execute on function public.complete_evaluation(uuid,uuid,integer) from authenticated;
revoke execute on function public.reopen_evaluation(uuid,uuid,integer,text) from authenticated;
drop function public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[]);
drop function public.complete_evaluation(uuid,uuid,integer);
drop function public.reopen_evaluation(uuid,uuid,integer,text);
drop function public.lock_evaluator_context(uuid,uuid,uuid,uuid,uuid);
drop function public.manager_can_reopen_evaluation(uuid,uuid,uuid,uuid);
drop function public.lock_manager_reopen_context(uuid,uuid,uuid,uuid);
revoke all on function public.lock_evaluator_context(uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lock_manager_evaluation_context(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.manager_has_evaluation_context(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.can_select_director_flag(uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[]) from public,anon,authenticated,service_role;
revoke all on function public.complete_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.lock_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.reopen_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.manage_director_evaluation_flag(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.can_select_director_flag(uuid) to authenticated;
grant execute on function public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[]) to authenticated;
grant execute on function public.complete_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer) to authenticated;
grant execute on function public.lock_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer) to authenticated;
grant execute on function public.reopen_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function public.manage_director_evaluation_flag(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text) to authenticated;
