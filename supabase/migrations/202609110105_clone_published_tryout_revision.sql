create or replace function public.clone_published_tryout_revision(
  p_organization_id uuid, p_source_tryout_id uuid, p_name text, p_slug text
) returns table(tryout_id uuid, slug text)
language plpgsql security definer set search_path='' as $$
declare source public.tryouts%rowtype; copy public.tryouts%rowtype; old_div public.tryout_divisions%rowtype; new_div uuid; old_session public.tryout_sessions%rowtype; new_session uuid; old_form public.registration_forms%rowtype; new_form uuid; old_version public.registration_form_versions%rowtype; new_version uuid; old_rubric public.rubrics%rowtype; new_rubric uuid; old_rv public.rubric_versions%rowtype; new_rv uuid;
begin
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise insufficient_privilege using message='forbidden'; end if;
  select * into source from public.tryouts where organization_id=p_organization_id and id=p_source_tryout_id and status='published';
  if not found then raise invalid_parameter_value using message='source must be published'; end if;
  insert into public.tryouts(organization_id,season_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at)
    values(p_organization_id,source.season_id,trim(p_name),trim(p_slug),source.sport,source.timezone,source.registration_starts_at,source.registration_ends_at) returning * into copy;
  create temporary table clone_div_map(old_id uuid primary key,new_id uuid not null) on commit drop;
  create temporary table clone_session_map(old_id uuid primary key,new_id uuid not null) on commit drop;
  for old_div in select * from public.tryout_divisions where organization_id=p_organization_id and tryout_id=source.id order by sort_order loop
    insert into public.tryout_divisions(organization_id,tryout_id,name,description,min_age,max_age,sort_order) values(p_organization_id,copy.id,old_div.name,old_div.description,old_div.min_age,old_div.max_age,old_div.sort_order) returning id into new_div; insert into clone_div_map values(old_div.id,new_div);
  end loop;
  for old_session in select * from public.tryout_sessions where organization_id=p_organization_id and tryout_id=source.id order by sort_order loop
    select new_id into new_div from clone_div_map where old_id=old_session.division_id;
    insert into public.tryout_sessions(organization_id,tryout_id,division_id,name,location,capacity,starts_at,ends_at,sort_order) values(p_organization_id,copy.id,new_div,old_session.name,old_session.location,old_session.capacity,old_session.starts_at,old_session.ends_at,old_session.sort_order) returning id into new_session; insert into clone_session_map values(old_session.id,new_session);
  end loop;
  for old_form in select * from public.registration_forms where organization_id=p_organization_id and tryout_id=source.id loop
    insert into public.registration_forms(organization_id,tryout_id,name) values(p_organization_id,copy.id,old_form.name) returning id into new_form;
    select * into old_version from public.registration_form_versions where organization_id=p_organization_id and registration_form_id=old_form.id order by version_number desc limit 1;
    if found then insert into public.registration_form_versions(organization_id,tryout_id,registration_form_id,version_number,schema) values(p_organization_id,copy.id,new_form,1,old_version.schema) returning id into new_version; insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id) values(p_organization_id,copy.id,new_version); end if;
  end loop;
  for old_rubric in select * from public.rubrics where organization_id=p_organization_id and tryout_id=source.id loop
    insert into public.rubrics(organization_id,tryout_id,name) values(p_organization_id,copy.id,old_rubric.name) returning id into new_rubric;
    select * into old_rv from public.rubric_versions where organization_id=p_organization_id and rubric_id=old_rubric.id order by version_number desc limit 1;
    if found then insert into public.rubric_versions(organization_id,tryout_id,rubric_id,version_number) values(p_organization_id,copy.id,new_rubric,1) returning id into new_rv; insert into public.rubric_categories(organization_id,tryout_id,rubric_version_id,name,description,sort_order,weight,scale_min,scale_max,guidance,is_priority) select p_organization_id,copy.id,new_rv,name,description,sort_order,weight,scale_min,scale_max,guidance,is_priority from public.rubric_categories where organization_id=p_organization_id and rubric_version_id=old_rv.id; insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) select p_organization_id,copy.id,sm.new_id,new_rv from public.session_rubrics sr join clone_session_map sm on sm.old_id=sr.session_id where sr.organization_id=p_organization_id and sr.tryout_id=source.id and sr.rubric_version_id=old_rv.id; end if;
  end loop;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details) values(p_organization_id,auth.uid(),'tryout.revision_created','tryout',copy.id,jsonb_build_object('sourceTryoutId',source.id));
  return query select copy.id,copy.slug;
end; $$;
revoke all on function public.clone_published_tryout_revision(uuid,uuid,text,text) from public;
grant execute on function public.clone_published_tryout_revision(uuid,uuid,text,text) to authenticated;
