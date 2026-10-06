-- A duplicate is a new draft configuration, never a copy of operational history.
create or replace function public.duplicate_tryout(p_organization_id uuid,p_source_tryout_id uuid)
returns table(tryout_id uuid,slug text)
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare
  source public.tryouts%rowtype; copied public.tryouts%rowtype;
  item record; new_id uuid; new_parent_id uuid; new_version_id uuid;
  division_ids jsonb := '{}'; session_ids jsonb := '{}'; rubric_version_ids jsonb := '{}';
  selected_version public.registration_form_versions%rowtype;
  copy_slug text; copy_rubric_name text; actor_expiry timestamptz;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_source_tryout_id) then
    raise insufficient_privilege using message='forbidden';
  end if;
  -- Configuration writers lock this root too, so the copy observes one complete configuration.
  select * into source from public.tryouts
  where organization_id=p_organization_id and id=p_source_tryout_id for update;
  if not found then raise invalid_parameter_value using message='source tryout not found'; end if;
  loop
    copy_slug := rtrim(left(source.slug,25),'-') || '-copy-' || replace(gen_random_uuid()::text,'-','');
    exit when not exists(select 1 from public.tryouts t where t.slug=copy_slug);
  end loop;
  insert into public.tryouts(organization_id,season_id,name,slug,sport,timezone,description,
    registration_starts_at,registration_ends_at,starts_at,ends_at,blind_mode,score_visibility,terminology)
  values(p_organization_id,source.season_id,left(source.name,153)||' (Copy)',copy_slug,source.sport,source.timezone,
    source.description,source.registration_starts_at,source.registration_ends_at,source.starts_at,source.ends_at,
    source.blind_mode,source.score_visibility,source.terminology) returning * into copied;

  -- A delegated organizer needs access to the draft they created. Other staff are never copied.
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
    select a.expires_at into actor_expiry from public.tryout_staff_assignments a
    where a.organization_id=p_organization_id and a.tryout_id=source.id and a.user_id=auth.uid()
      and a.role='director' and a.scope_kind='tryout' and a.revoked_at is null
      and (a.expires_at is null or a.expires_at>now());
    insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id,expires_at)
    values(p_organization_id,auth.uid(),'director','tryout',copied.id,auth.uid(),actor_expiry);
  end if;
  for item in select * from public.tryout_divisions where organization_id=p_organization_id and tryout_id=source.id order by sort_order loop
    insert into public.tryout_divisions(organization_id,tryout_id,name,description,min_age,max_age,sort_order)
    values(p_organization_id,copied.id,item.name,item.description,item.min_age,item.max_age,item.sort_order) returning id into new_id;
    division_ids := division_ids || jsonb_build_object(item.id::text,new_id);
  end loop;
  insert into public.tryout_positions(organization_id,tryout_id,name,code,is_preset,sort_order)
  select p_organization_id,copied.id,name,code,is_preset,sort_order from public.tryout_positions
  where organization_id=p_organization_id and tryout_id=source.id;
  for item in select * from public.tryout_sessions where organization_id=p_organization_id and tryout_id=source.id order by sort_order loop
    insert into public.tryout_sessions(organization_id,tryout_id,division_id,name,location,capacity,starts_at,ends_at,sort_order)
    values(p_organization_id,copied.id,(division_ids->>item.division_id::text)::uuid,item.name,item.location,item.capacity,item.starts_at,item.ends_at,item.sort_order)
    returning id into new_id;
    session_ids := session_ids || jsonb_build_object(item.id::text,new_id);
  end loop;
  insert into public.session_groups(organization_id,tryout_id,session_id,division_id,name,sort_order,capacity)
  select p_organization_id,copied.id,(session_ids->>session_id::text)::uuid,(division_ids->>division_id::text)::uuid,name,sort_order,capacity
  from public.session_groups where organization_id=p_organization_id and tryout_id=source.id;

  select v.* into selected_version from public.registration_form_versions v
  join public.tryout_registration_form_selections s on s.organization_id=v.organization_id and s.tryout_id=v.tryout_id and s.registration_form_version_id=v.id
  where s.organization_id=p_organization_id and s.tryout_id=source.id for share of v;
  if found then
    insert into public.registration_forms(organization_id,tryout_id,name)
    select p_organization_id,copied.id,f.name from public.registration_forms f where f.organization_id=p_organization_id and f.id=selected_version.registration_form_id
    returning id into new_parent_id;
    insert into public.registration_form_versions(organization_id,tryout_id,registration_form_id,version_number,schema)
    values(p_organization_id,copied.id,new_parent_id,1,selected_version.schema) returning id into new_version_id;
    insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
    values(p_organization_id,copied.id,new_version_id);
  end if;
  insert into private.registration_notification_settings(organization_id,tryout_id,notification_email,updated_by_user_id)
  select p_organization_id,copied.id,notification_email,auth.uid() from private.registration_notification_settings
  where organization_id=p_organization_id and tryout_id=source.id;

  -- Each attached version becomes an independent editable draft. Multiple historical
  -- versions of one source rubric cannot share its single-draft constraint.
  for item in
    select v.*,r.name,count(*) over(partition by r.id) as attached_versions
    from public.rubric_versions v join public.rubrics r on r.organization_id=v.organization_id and r.id=v.rubric_id
    where v.organization_id=p_organization_id and v.tryout_id=source.id and exists(
      select 1 from public.session_rubrics sr where sr.organization_id=p_organization_id and sr.tryout_id=source.id and sr.rubric_version_id=v.id)
    order by r.id,v.version_number
  loop
    copy_rubric_name := case when item.attached_versions=1 then item.name
      else left(item.name,71)||' ('||item.id::text||')' end;
    insert into public.rubrics(organization_id,tryout_id,name) values(p_organization_id,copied.id,copy_rubric_name) returning id into new_parent_id;
    insert into public.rubric_versions(organization_id,tryout_id,rubric_id,version_number)
    values(p_organization_id,copied.id,new_parent_id,1) returning id into new_version_id;
    insert into public.rubric_categories(organization_id,tryout_id,rubric_version_id,name,description,sort_order,weight,scale_min,scale_max,guidance,is_priority)
    select p_organization_id,copied.id,new_version_id,name,description,sort_order,weight,scale_min,scale_max,guidance,is_priority
    from public.rubric_categories where organization_id=p_organization_id and rubric_version_id=item.id order by sort_order;
    rubric_version_ids := rubric_version_ids || jsonb_build_object(item.id::text,new_version_id);
  end loop;
  insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id)
  select p_organization_id,copied.id,(session_ids->>session_id::text)::uuid,(rubric_version_ids->>rubric_version_id::text)::uuid
  from public.session_rubrics where organization_id=p_organization_id and tryout_id=source.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'tryout.duplicated','tryout',copied.id,jsonb_build_object('sourceTryoutId',source.id));
  return query select copied.id,copied.slug;
end $$;
revoke all on function public.duplicate_tryout(uuid,uuid) from public,anon,service_role;
grant execute on function public.duplicate_tryout(uuid,uuid) to authenticated;
