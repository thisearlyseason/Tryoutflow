create or replace function public.clone_published_tryout_revision(
  p_organization_id uuid, p_source_tryout_id uuid, p_name text, p_slug text
) returns table(tryout_id uuid, slug text)
language plpgsql security definer set search_path='' as $$
declare source public.tryouts%rowtype; copy public.tryouts%rowtype; old_div public.tryout_divisions%rowtype; new_div uuid; old_session public.tryout_sessions%rowtype;
begin
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise insufficient_privilege using message='forbidden'; end if;
  select * into source from public.tryouts where organization_id=p_organization_id and id=p_source_tryout_id and status='published';
  if not found then raise invalid_parameter_value using message='source must be published'; end if;
  insert into public.tryouts(organization_id,season_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at)
    values(p_organization_id,source.season_id,trim(p_name),trim(p_slug),source.sport,source.timezone,source.registration_starts_at,source.registration_ends_at) returning * into copy;
  for old_div in select * from public.tryout_divisions where organization_id=p_organization_id and tryout_id=source.id order by sort_order loop
    insert into public.tryout_divisions(organization_id,tryout_id,name,description,min_age,max_age,sort_order) values(p_organization_id,copy.id,old_div.name,old_div.description,old_div.min_age,old_div.max_age,old_div.sort_order) returning id into new_div;
    for old_session in select * from public.tryout_sessions where organization_id=p_organization_id and tryout_id=source.id and division_id=old_div.id order by sort_order loop
      insert into public.tryout_sessions(organization_id,tryout_id,division_id,name,location,capacity,starts_at,ends_at,sort_order) values(p_organization_id,copy.id,new_div,old_session.name,old_session.location,old_session.capacity,old_session.starts_at,old_session.ends_at,old_session.sort_order);
    end loop;
  end loop;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details) values(p_organization_id,auth.uid(),'tryout.revision_created','tryout',copy.id,jsonb_build_object('sourceTryoutId',source.id));
  return query select copy.id,copy.slug;
end; $$;
