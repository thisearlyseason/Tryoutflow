-- Independent evaluator records are written only through optimistic, tenant-safe
-- commands. Evaluators can select their own currently assigned context but never
-- peer work; management reads are deliberately deferred to scoped projections.

alter table public.session_enrollments
  add constraint session_enrollments_evaluation_context_key
  unique (organization_id, tryout_id, registration_id, session_id);

create table public.organization_evaluation_note_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint organization_evaluation_note_tags_organization_id_id_key unique (organization_id,id),
  constraint organization_evaluation_note_tags_label_check check (char_length(trim(label)) between 1 and 80),
  constraint organization_evaluation_note_tags_label_key unique (organization_id,label)
);
create trigger set_organization_evaluation_note_tags_updated_at before update
  on public.organization_evaluation_note_tags for each row execute function public.set_updated_at();
create unique index organization_evaluation_note_tags_canonical_label_key
  on public.organization_evaluation_note_tags(organization_id,lower(label));

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  tryout_registration_id uuid not null,
  tryout_session_id uuid not null,
  evaluator_user_id uuid not null references auth.users(id) on delete restrict,
  rubric_version_id uuid not null,
  state text not null default 'draft',
  version integer not null default 1,
  completed_at timestamptz,
  reopened_at timestamptz,
  reopened_by_user_id uuid references auth.users(id) on delete restrict,
  reopen_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint evaluations_organization_id_id_key unique (organization_id,id),
  constraint evaluations_context_rubric_id_key unique (organization_id,tryout_id,rubric_version_id,id),
  constraint evaluations_evaluator_id_key unique (organization_id,evaluator_user_id,id),
  constraint evaluations_registration_fkey foreign key (organization_id,tryout_id,tryout_registration_id)
    references public.tryout_registrations(organization_id,tryout_id,id) on delete cascade,
  constraint evaluations_enrollment_fkey foreign key (organization_id,tryout_id,tryout_registration_id,tryout_session_id)
    references public.session_enrollments(organization_id,tryout_id,registration_id,session_id) on delete restrict,
  constraint evaluations_rubric_version_fkey foreign key (organization_id,tryout_id,rubric_version_id)
    references public.rubric_versions(organization_id,tryout_id,id) on delete restrict,
  constraint evaluations_state_check check (state in ('draft','completed','locked','reopened')),
  constraint evaluations_version_check check (version between 1 and 2147483647),
  constraint evaluations_completion_check check (
    (state in ('draft','reopened') and completed_at is null)
    or (state in ('completed','locked') and completed_at is not null)
  ),
  constraint evaluations_reopen_check check (
    (reopened_at is null and reopened_by_user_id is null and reopen_reason is null)
    or (reopened_at is not null and reopened_by_user_id is not null and char_length(trim(reopen_reason)) between 10 and 500)
  ),
  constraint evaluations_natural_key unique (organization_id,tryout_registration_id,tryout_session_id,evaluator_user_id)
);
create index evaluations_tryout_session_state_idx
  on public.evaluations(organization_id,tryout_id,tryout_session_id,state);
create index evaluations_evaluator_context_idx
  on public.evaluations(evaluator_user_id,organization_id,tryout_id,tryout_session_id);
create trigger set_evaluations_updated_at before update on public.evaluations
  for each row execute function public.set_updated_at();

create table public.evaluation_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  evaluation_id uuid not null,
  rubric_version_id uuid not null,
  rubric_category_id uuid not null,
  value integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint evaluation_scores_organization_id_id_key unique (organization_id,id),
  constraint evaluation_scores_evaluation_fkey foreign key (organization_id,tryout_id,rubric_version_id,evaluation_id)
    references public.evaluations(organization_id,tryout_id,rubric_version_id,id) on delete cascade,
  constraint evaluation_scores_category_fkey foreign key (organization_id,tryout_id,rubric_version_id,rubric_category_id)
    references public.rubric_categories(organization_id,tryout_id,rubric_version_id,id) on delete restrict,
  constraint evaluation_scores_value_positive check (value > 0),
  constraint evaluation_scores_category_key unique (organization_id,evaluation_id,rubric_category_id)
);
create trigger set_evaluation_scores_updated_at before update on public.evaluation_scores
  for each row execute function public.set_updated_at();

create function public.assert_valid_evaluation_score()
returns trigger language plpgsql security definer set search_path='' as $$
declare category public.rubric_categories%rowtype;
declare evaluation_state text;
begin
  select * into category from public.rubric_categories c
  where c.organization_id=new.organization_id and c.tryout_id=new.tryout_id
    and c.rubric_version_id=new.rubric_version_id and c.id=new.rubric_category_id;
  select e.state into evaluation_state from public.evaluations e
  where e.organization_id=new.organization_id and e.tryout_id=new.tryout_id
    and e.rubric_version_id=new.rubric_version_id and e.id=new.evaluation_id;
  if not found or evaluation_state not in ('draft','reopened')
    or new.value not between category.scale_min and category.scale_max
  then raise exception 'invalid evaluation score' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger assert_valid_evaluation_score before insert or update on public.evaluation_scores
  for each row execute function public.assert_valid_evaluation_score();

create table public.evaluation_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  evaluation_id uuid not null,
  evaluator_user_id uuid not null,
  note text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint evaluation_notes_organization_id_id_key unique (organization_id,id),
  constraint evaluation_notes_evaluation_fkey foreign key (organization_id,evaluator_user_id,evaluation_id)
    references public.evaluations(organization_id,evaluator_user_id,id) on delete cascade,
  constraint evaluation_notes_note_check check (char_length(trim(note)) between 1 and 4000),
  constraint evaluation_notes_evaluation_key unique (organization_id,evaluation_id)
);
create trigger set_evaluation_notes_updated_at before update on public.evaluation_notes
  for each row execute function public.set_updated_at();

create table public.evaluation_note_tags (
  organization_id uuid not null,
  evaluation_id uuid not null,
  note_tag_id uuid not null,
  evaluator_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,evaluation_id,note_tag_id),
  constraint evaluation_note_tags_evaluation_fkey foreign key (organization_id,evaluator_user_id,evaluation_id)
    references public.evaluations(organization_id,evaluator_user_id,id) on delete cascade,
  constraint evaluation_note_tags_tag_fkey foreign key (organization_id,note_tag_id)
    references public.organization_evaluation_note_tags(organization_id,id) on delete restrict
);

create table public.athlete_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  evaluation_id uuid not null,
  evaluator_user_id uuid not null,
  flag_type text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint athlete_flags_organization_id_id_key unique (organization_id,id),
  constraint athlete_flags_evaluation_fkey foreign key (organization_id,evaluator_user_id,evaluation_id)
    references public.evaluations(organization_id,evaluator_user_id,id) on delete cascade,
  constraint athlete_flags_type_check check (flag_type in ('needs_another_look','injury_concern','eligibility_review')),
  constraint athlete_flags_evaluation_type_key unique (organization_id,evaluation_id,flag_type)
);

create function public.evaluator_has_active_context(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_registration_id uuid,
  p_session_id uuid,
  p_evaluator_user_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select p_evaluator_user_id=auth.uid()
    and exists(
      select 1
      from public.organization_members m
      join public.tryout_registrations r
        on r.organization_id=m.organization_id and r.id=p_registration_id
       and r.tryout_id=p_tryout_id and r.status='submitted'
      join public.session_enrollments se
        on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
       and se.registration_id=r.id and se.session_id=p_session_id
      join public.tryouts t
        on t.organization_id=r.organization_id and t.id=r.tryout_id
       and t.status in ('published','finalized')
      where m.organization_id=p_organization_id and m.user_id=p_evaluator_user_id and m.status='active'
        and exists(
          select 1 from public.tryout_staff_assignments a
          where a.organization_id=p_organization_id and a.user_id=p_evaluator_user_id
            and a.role='evaluator' and a.tryout_id=p_tryout_id and a.revoked_at is null
            and (a.expires_at is null or a.expires_at>clock_timestamp())
            and (
              a.scope_kind='tryout'
              or (a.scope_kind='division' and a.division_id=r.division_id)
              or (a.scope_kind='session' and a.session_id=p_session_id)
              or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=se.group_id)
            )
        )
    );
$$;

-- Mutation-time authorization also freezes the principal, tenant, membership,
-- placement, tryout lifecycle, and every matching evaluator grant until commit.
-- The lock order matches staffing: tenant, principal, membership, then grant.
create function public.lock_evaluator_context(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_registration_id uuid,
  p_session_id uuid,
  p_evaluator_user_id uuid
) returns boolean
language plpgsql security definer set search_path='' as $$
declare resolved_division_id uuid;
declare resolved_group_id uuid;
begin
  if p_evaluator_user_id<>auth.uid() then return false; end if;
  perform 1 from public.organizations o where o.id=p_organization_id for key share;
  if not found then return false; end if;
  perform 1 from auth.users u where u.id=p_evaluator_user_id for key share;
  if not found then return false; end if;
  perform 1 from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=p_evaluator_user_id and m.status='active'
    for share;
  if not found then return false; end if;
  select r.division_id,se.group_id into resolved_division_id,resolved_group_id
  from public.tryout_registrations r
  join public.session_enrollments se on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
    and se.registration_id=r.id and se.session_id=p_session_id
  join public.tryouts t on t.organization_id=r.organization_id and t.id=r.tryout_id
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id
    and r.status='submitted' and t.status in ('published','finalized')
  for share of r,se,t;
  if not found then return false; end if;
  perform 1 from public.tryout_staff_assignments a
  where a.organization_id=p_organization_id and a.user_id=p_evaluator_user_id
    and a.role='evaluator' and a.tryout_id=p_tryout_id and a.revoked_at is null
    and (a.expires_at is null or a.expires_at>clock_timestamp())
    and (a.scope_kind='tryout' or (a.scope_kind='division' and a.division_id=resolved_division_id)
      or (a.scope_kind='session' and a.session_id=p_session_id)
      or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=resolved_group_id))
  for share;
  return found;
end;
$$;

create function public.manager_can_reopen_evaluation(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_registration_id uuid,
  p_session_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or exists(
      select 1 from public.tryout_registrations r
      join public.session_enrollments se
        on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
       and se.registration_id=r.id and se.session_id=p_session_id
      join public.tryout_staff_assignments a
        on a.organization_id=r.organization_id and a.tryout_id=r.tryout_id
       and a.user_id=auth.uid() and a.role='director' and a.revoked_at is null
       and (a.expires_at is null or a.expires_at>clock_timestamp())
       and (
         a.scope_kind='tryout'
         or (a.scope_kind='division' and a.division_id=r.division_id)
         or (a.scope_kind='session' and a.session_id=p_session_id)
         or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=se.group_id)
       )
      join public.organization_members m
        on m.organization_id=a.organization_id and m.user_id=a.user_id and m.status='active'
      where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id
    );
$$;

create function public.lock_manager_reopen_context(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_session_id uuid
) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid();
declare actor_role text;
declare resolved_division_id uuid;
declare resolved_group_id uuid;
begin
  if actor_id is null then return false; end if;
  perform 1 from public.organizations o where o.id=p_organization_id for key share;
  if not found then return false; end if;
  perform 1 from auth.users u where u.id=actor_id for key share;
  if not found then return false; end if;
  select m.role into actor_role from public.organization_members m
    where m.organization_id=p_organization_id and m.user_id=actor_id and m.status='active' for share;
  if not found then return false; end if;
  if actor_role in ('owner','administrator') then return true; end if;
  select r.division_id,se.group_id into resolved_division_id,resolved_group_id
  from public.tryout_registrations r
  join public.session_enrollments se on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id
    and se.registration_id=r.id and se.session_id=p_session_id
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id
  for share of r,se;
  if not found then return false; end if;
  perform 1 from public.tryout_staff_assignments a
  where a.organization_id=p_organization_id and a.user_id=actor_id and a.role='director'
    and a.tryout_id=p_tryout_id and a.revoked_at is null
    and (a.expires_at is null or a.expires_at>clock_timestamp())
    and (a.scope_kind='tryout' or (a.scope_kind='division' and a.division_id=resolved_division_id)
      or (a.scope_kind='session' and a.session_id=p_session_id)
      or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=resolved_group_id))
  for share;
  return found;
end;
$$;

-- Safe RLS predicate: callers can ask only whether the current JWT may select
-- one evaluation. It never reveals ownership, tenant, scores, or note content.
create function public.can_select_own_evaluation(p_evaluation_id uuid)
returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.evaluations e
    where e.id=p_evaluation_id and e.evaluator_user_id=auth.uid()
      and public.evaluator_has_active_context(e.organization_id,e.tryout_id,e.tryout_registration_id,e.tryout_session_id,e.evaluator_user_id)
  );
$$;

create function public.configure_evaluation_note_tag(
  p_organization_id uuid,p_note_tag_id uuid,p_label text,p_active boolean
) returns table(outcome text,note_tag_id uuid)
language plpgsql security definer set search_path='' as $$
declare saved_id uuid;
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id,array['owner','administrator'])
  then return query select 'forbidden',null::uuid; return; end if;
  if p_label is null or char_length(trim(p_label)) not between 1 and 80 or p_active is null
  then return query select 'invalid_tag',null::uuid; return; end if;
  begin
    if p_note_tag_id is null then
      insert into public.organization_evaluation_note_tags(organization_id,label,active)
      values(p_organization_id,trim(p_label),p_active) returning id into saved_id;
    else
      update public.organization_evaluation_note_tags t set label=trim(p_label),active=p_active
      where t.organization_id=p_organization_id and t.id=p_note_tag_id returning id into saved_id;
      if saved_id is null then return query select 'invalid_tag',null::uuid; return; end if;
    end if;
  exception when unique_violation then
    return query select 'conflict',null::uuid; return;
  end;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'evaluation.note_tag_configured','evaluation_note_tag',saved_id,
    jsonb_build_object('active',p_active));
  return query select 'saved',saved_id;
end;
$$;

create function public.save_evaluation_draft(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_registration_id uuid,
  p_session_id uuid,
  p_rubric_version_id uuid,
  p_expected_version integer,
  p_scores jsonb,
  p_note text default null,
  p_note_tag_ids uuid[] default array[]::uuid[],
  p_flags text[] default array[]::text[]
) returns table(outcome text,evaluation_id uuid,version integer)
language plpgsql security definer set search_path='' as $$
declare
  current_evaluation public.evaluations%rowtype;
  score jsonb;
  score_category_id uuid;
  score_value integer;
  current_user_id uuid := auth.uid();
  validated_category_ids uuid[] := array[]::uuid[];
  validated_values integer[] := array[]::integer[];
begin
  if current_user_id is null or not public.lock_evaluator_context(
    p_organization_id,p_tryout_id,p_registration_id,p_session_id,current_user_id
  ) then return query select 'forbidden',null::uuid,null::integer; return; end if;

  if p_expected_version is null or p_expected_version<0 then
    return query select 'invalid_context',null::uuid,null::integer; return;
  end if;
  perform 1 from public.session_rubrics sr join public.rubric_versions rv
      on rv.organization_id=sr.organization_id and rv.tryout_id=sr.tryout_id and rv.id=sr.rubric_version_id
    where sr.organization_id=p_organization_id and sr.tryout_id=p_tryout_id
      and sr.session_id=p_session_id and sr.rubric_version_id=p_rubric_version_id
      and rv.status='published'
    for share of sr,rv;
  if not found then return query select 'invalid_context',null::uuid,null::integer; return; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','evaluation',p_organization_id,p_registration_id,p_session_id,current_user_id),0));
  select * into current_evaluation from public.evaluations e
  where e.organization_id=p_organization_id and e.tryout_registration_id=p_registration_id
    and e.tryout_session_id=p_session_id and e.evaluator_user_id=current_user_id for update;

  if found then
    if current_evaluation.rubric_version_id<>p_rubric_version_id or current_evaluation.tryout_id<>p_tryout_id then
      return query select 'invalid_context',null::uuid,null::integer; return;
    end if;
    if current_evaluation.state in ('completed','locked') then
      return query select 'locked',current_evaluation.id,current_evaluation.version; return;
    end if;
    if current_evaluation.version<>p_expected_version then
      return query select 'conflict',current_evaluation.id,current_evaluation.version; return;
    end if;
  elsif p_expected_version<>0 then
    return query select 'conflict',null::uuid,null::integer; return;
  end if;

  if jsonb_typeof(p_scores)<>'array' or jsonb_array_length(p_scores)>100
    or coalesce(cardinality(p_note_tag_ids),0)>50 or coalesce(cardinality(p_flags),0)>20
    or (p_note is not null and (char_length(trim(p_note))=0 or char_length(trim(p_note))>4000))
    or cardinality(p_note_tag_ids)<>cardinality(array(select distinct x from unnest(p_note_tag_ids) x))
    or cardinality(p_flags)<>cardinality(array(select distinct x from unnest(p_flags) x))
    or exists(select 1 from unnest(p_flags) x where x not in ('needs_another_look','injury_concern','eligibility_review'))
  then return query select 'invalid_score',coalesce(current_evaluation.id,null),coalesce(current_evaluation.version,null); return; end if;

  if exists(
    select 1 from unnest(p_note_tag_ids) tag_id
    where not exists(select 1 from public.organization_evaluation_note_tags t
      where t.organization_id=p_organization_id and t.id=tag_id and t.active)
  ) then return query select 'invalid_note_tag',coalesce(current_evaluation.id,null),coalesce(current_evaluation.version,null); return; end if;

  for score in select value from jsonb_array_elements(p_scores) loop
    begin
      if jsonb_typeof(score)<>'object' or score-array['categoryId','value']<>'{}'::jsonb
        or jsonb_typeof(score->'categoryId')<>'string' or jsonb_typeof(score->'value')<>'number'
        or (score->>'value') !~ '^-?[0-9]+$'
      then raise invalid_parameter_value; end if;
      score_category_id := (score->>'categoryId')::uuid;
      score_value := (score->>'value')::integer;
      if score_category_id=any(validated_category_ids) then raise invalid_parameter_value; end if;
      if not exists(select 1 from public.rubric_categories c
        where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id
          and c.rubric_version_id=p_rubric_version_id and c.id=score_category_id
          and score_value between c.scale_min and c.scale_max)
      then raise invalid_parameter_value; end if;
      validated_category_ids:=array_append(validated_category_ids,score_category_id);
      validated_values:=array_append(validated_values,score_value);
    exception when others then
      return query select 'invalid_score',coalesce(current_evaluation.id,null),coalesce(current_evaluation.version,null); return;
    end;
  end loop;

  if current_evaluation.id is null then
    insert into public.evaluations(organization_id,tryout_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,current_user_id,p_rubric_version_id)
    returning * into current_evaluation;
  else
    update public.evaluations e set version=e.version+1,state='draft',completed_at=null
      where e.id=current_evaluation.id returning * into current_evaluation;
  end if;

  delete from public.evaluation_scores s where s.organization_id=p_organization_id and s.evaluation_id=current_evaluation.id;
  insert into public.evaluation_scores(organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value)
    select p_organization_id,p_tryout_id,current_evaluation.id,p_rubric_version_id,c.category_id,v.score_value
    from unnest(validated_category_ids) with ordinality c(category_id,ordinality)
    join unnest(validated_values) with ordinality v(score_value,ordinality) using(ordinality);
  delete from public.evaluation_notes n where n.organization_id=p_organization_id and n.evaluation_id=current_evaluation.id;
  if p_note is not null then insert into public.evaluation_notes(organization_id,evaluation_id,evaluator_user_id,note)
    values(p_organization_id,current_evaluation.id,current_user_id,trim(p_note)); end if;
  delete from public.evaluation_note_tags t where t.organization_id=p_organization_id and t.evaluation_id=current_evaluation.id;
  insert into public.evaluation_note_tags(organization_id,evaluation_id,note_tag_id,evaluator_user_id)
    select p_organization_id,current_evaluation.id,x,current_user_id from unnest(p_note_tag_ids) x;
  delete from public.athlete_flags f where f.organization_id=p_organization_id and f.evaluation_id=current_evaluation.id;
  insert into public.athlete_flags(organization_id,evaluation_id,evaluator_user_id,flag_type)
    select p_organization_id,current_evaluation.id,current_user_id,x from unnest(p_flags) x;
  return query select 'saved',current_evaluation.id,current_evaluation.version;
end;
$$;

create function public.complete_evaluation(p_organization_id uuid,p_evaluation_id uuid,p_expected_version integer)
returns table(outcome text,version integer)
language plpgsql security definer set search_path='' as $$
declare target public.evaluations%rowtype;
begin
  if auth.uid() is null then return query select 'forbidden',null::integer; return; end if;
  select * into target from public.evaluations e where e.organization_id=p_organization_id and e.id=p_evaluation_id;
  if not found or target.evaluator_user_id<>auth.uid() or not public.lock_evaluator_context(
    target.organization_id,target.tryout_id,target.tryout_registration_id,target.tryout_session_id,target.evaluator_user_id
  ) then return query select 'forbidden',null::integer; return; end if;
  select * into target from public.evaluations e where e.organization_id=p_organization_id and e.id=p_evaluation_id for update;
  if p_expected_version is null or target.version<>p_expected_version then return query select 'conflict',target.version; return; end if;
  if target.state in ('completed','locked') then return query select 'locked',target.version; return; end if;
  if exists(
    select 1 from public.rubric_categories c
    where c.organization_id=target.organization_id and c.tryout_id=target.tryout_id
      and c.rubric_version_id=target.rubric_version_id
      and not exists(select 1 from public.evaluation_scores s
        where s.organization_id=target.organization_id and s.evaluation_id=target.id and s.rubric_category_id=c.id)
  ) then return query select 'required_scores_missing',target.version; return; end if;
  update public.evaluations e set state='completed',version=e.version+1,completed_at=clock_timestamp()
    where e.id=target.id returning e.version into target.version;
  return query select 'completed',target.version;
end;
$$;

create function public.reopen_evaluation(p_organization_id uuid,p_evaluation_id uuid,p_expected_version integer,p_reason text)
returns table(outcome text,version integer)
language plpgsql security definer set search_path='' as $$
declare target public.evaluations%rowtype;
declare before_version integer;
begin
  if auth.uid() is null then return query select 'forbidden',null::integer; return; end if;
  select * into target from public.evaluations e where e.organization_id=p_organization_id and e.id=p_evaluation_id;
  if not found or not public.lock_manager_reopen_context(target.organization_id,target.tryout_id,target.tryout_registration_id,target.tryout_session_id)
  then return query select 'forbidden',null::integer; return; end if;
  select * into target from public.evaluations e where e.organization_id=p_organization_id and e.id=p_evaluation_id for update;
  if p_reason is null or char_length(trim(p_reason)) not between 10 and 500
  then return query select 'invalid_reason',target.version; return; end if;
  if p_expected_version is null or target.version<>p_expected_version then return query select 'conflict',target.version; return; end if;
  if target.state not in ('completed','locked') then return query select 'invalid_state',target.version; return; end if;
  before_version:=target.version;
  update public.evaluations e set state='reopened',version=e.version+1,completed_at=null,
    reopened_at=clock_timestamp(),reopened_by_user_id=auth.uid(),reopen_reason=trim(p_reason)
    where e.id=target.id returning e.version into target.version;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(target.organization_id,auth.uid(),'evaluation.reopened','evaluation',target.id,
    jsonb_build_object('reason',trim(p_reason),'beforeState',target.state,'afterState','reopened','beforeVersion',before_version,'afterVersion',target.version));
  return query select 'reopened',target.version;
end;
$$;

alter table public.organization_evaluation_note_tags enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_scores enable row level security;
alter table public.evaluation_notes enable row level security;
alter table public.evaluation_note_tags enable row level security;
alter table public.athlete_flags enable row level security;

create policy evaluation_note_tag_config_member_select on public.organization_evaluation_note_tags
  for select to authenticated using (public.is_active_organization_member(organization_id));
create policy evaluations_own_active_select on public.evaluations for select to authenticated using (
  public.can_select_own_evaluation(id)
);
create policy evaluation_scores_own_active_select on public.evaluation_scores for select to authenticated using (
  exists(select 1 from public.evaluations e where e.organization_id=evaluation_scores.organization_id
    and e.id=evaluation_scores.evaluation_id and e.evaluator_user_id=auth.uid())
);
create policy evaluation_notes_own_active_select on public.evaluation_notes for select to authenticated using (
  evaluator_user_id=auth.uid() and exists(select 1 from public.evaluations e where e.organization_id=evaluation_notes.organization_id
    and e.id=evaluation_notes.evaluation_id and e.evaluator_user_id=auth.uid())
);
create policy evaluation_note_tags_own_active_select on public.evaluation_note_tags for select to authenticated using (
  evaluator_user_id=auth.uid() and exists(select 1 from public.evaluations e where e.organization_id=evaluation_note_tags.organization_id
    and e.id=evaluation_note_tags.evaluation_id and e.evaluator_user_id=auth.uid())
);
create policy athlete_flags_own_active_select on public.athlete_flags for select to authenticated using (
  evaluator_user_id=auth.uid() and exists(select 1 from public.evaluations e where e.organization_id=athlete_flags.organization_id
    and e.id=athlete_flags.evaluation_id and e.evaluator_user_id=auth.uid())
);

revoke all on public.organization_evaluation_note_tags,public.evaluations,public.evaluation_scores,
  public.evaluation_notes,public.evaluation_note_tags,public.athlete_flags from public,anon,authenticated,service_role;
grant select on public.organization_evaluation_note_tags,public.evaluations,public.evaluation_scores,
  public.evaluation_notes,public.evaluation_note_tags,public.athlete_flags to authenticated;

revoke execute on function public.evaluator_has_active_context(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.lock_evaluator_context(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.manager_can_reopen_evaluation(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.lock_manager_reopen_context(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.can_select_own_evaluation(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.assert_valid_evaluation_score() from public,anon,authenticated,service_role;
revoke execute on function public.configure_evaluation_note_tag(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke execute on function public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[]) from public,anon,authenticated,service_role;
revoke execute on function public.complete_evaluation(uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke execute on function public.reopen_evaluation(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[]) to authenticated;
grant execute on function public.complete_evaluation(uuid,uuid,integer) to authenticated;
grant execute on function public.reopen_evaluation(uuid,uuid,integer,text) to authenticated;
grant execute on function public.can_select_own_evaluation(uuid) to authenticated;
grant execute on function public.configure_evaluation_note_tag(uuid,uuid,text,boolean) to authenticated;
