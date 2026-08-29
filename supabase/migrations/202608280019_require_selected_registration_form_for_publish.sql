create or replace function public.validate_tryout_for_publish(p_organization_id uuid, p_tryout_id uuid)
returns table (blocker text) language plpgsql security definer set search_path = '' as $$
declare target public.tryouts%rowtype;
begin
  if not public.can_manage_tryout_root(p_organization_id, p_tryout_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into target from public.tryouts where organization_id = p_organization_id and id = p_tryout_id;
  if not found then return; end if;
  return query
  select item.blocker from (values
    (10, 'division_missing'::text, not exists (select 1 from public.tryout_divisions where organization_id=p_organization_id and tryout_id=p_tryout_id)),
    (20, 'session_missing'::text, not exists (select 1 from public.tryout_sessions where organization_id=p_organization_id and tryout_id=p_tryout_id)),
    (30, 'registration_form_missing'::text, not exists (
      select 1
      from public.tryout_registration_form_selections as selection
      join public.registration_form_versions as version
        on version.organization_id = selection.organization_id
       and version.tryout_id = selection.tryout_id
       and version.id = selection.registration_form_version_id
      where selection.organization_id = p_organization_id
        and selection.tryout_id = p_tryout_id
    )),
    (40, 'registration_closed'::text, target.registration_starts_at is null or target.registration_ends_at is null or target.registration_ends_at <= clock_timestamp()),
    (50, 'rubric_invalid'::text, exists (
      select 1 from public.tryout_sessions as session left join public.session_rubrics as binding on binding.organization_id=session.organization_id and binding.tryout_id=session.tryout_id and binding.session_id=session.id
      where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id and binding.id is null
    ) or exists (
      select 1 from public.session_rubrics as binding where binding.organization_id=p_organization_id and binding.tryout_id=p_tryout_id
      and coalesce((select sum(category.weight) from public.rubric_categories as category where category.organization_id=binding.organization_id and category.tryout_id=binding.tryout_id and category.rubric_version_id=binding.rubric_version_id),0) <> 100
    ))
  ) as item(priority, blocker, present) where item.present order by item.priority;
end;
$$;

create or replace function public.publish_tryout(p_organization_id uuid, p_tryout_id uuid, p_expected_version integer)
returns table (outcome text, public_slug text) language plpgsql security definer set search_path = '' as $$
declare target public.tryouts%rowtype; form_version public.registration_form_versions%rowtype; form_exists boolean; validation_blocker text;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into target from public.tryouts where organization_id=p_organization_id and id=p_tryout_id for update;
  if not found then return query select 'not_found'::text,null::text; return; end if;
  if target.status='published' then return query select 'already_published'::text,target.slug; return; end if;
  if target.status <> 'draft' or target.version <> p_expected_version then return query select 'conflict'::text,null::text; return; end if;
  select version.* into form_version
  from public.tryout_registration_form_selections as selection
  join public.registration_form_versions as version
    on version.organization_id=selection.organization_id
   and version.tryout_id=selection.tryout_id
   and version.id=selection.registration_form_version_id
  where selection.organization_id=p_organization_id and selection.tryout_id=p_tryout_id
  for update of selection,version;
  form_exists:=found;
  perform 1 from public.rubric_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and id in (select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id) order by id for update;
  perform 1 from public.rubric_categories where organization_id=p_organization_id and tryout_id=p_tryout_id and rubric_version_id in (select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id) order by rubric_version_id,id for update;
  select blocker into validation_blocker from public.validate_tryout_for_publish(p_organization_id,p_tryout_id) limit 1;
  if validation_blocker is not null then return query select validation_blocker,null::text; return; end if;
  if not form_exists then return query select 'registration_form_missing'::text,null::text; return; end if;
  update public.registration_form_versions set status='published',published_at=clock_timestamp() where id=form_version.id and organization_id=p_organization_id and status='draft';
  update public.rubric_versions set status='published',published_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and status='draft' and id in (select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id);
  update public.tryouts set status='published',published_at=clock_timestamp() where organization_id=p_organization_id and id=p_tryout_id and version=p_expected_version;
  if not found then return query select 'conflict'::text,null::text; return; end if;
  insert into public.tryout_publications (organization_id,tryout_id,registration_form_version_id) values (p_organization_id,p_tryout_id,form_version.id);
  insert into public.audit_logs (organization_id,actor_user_id,action,entity_type,entity_id) values (p_organization_id,auth.uid(),'tryout.published','tryout',p_tryout_id);
  return query select 'published'::text,target.slug;
end;
$$;
