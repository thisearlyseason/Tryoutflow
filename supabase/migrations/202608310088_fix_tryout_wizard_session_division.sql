create or replace function public.save_tryout_wizard_configuration(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_step text,
  p_payload jsonb
)
returns table(outcome text)
language plpgsql security definer set search_path='' as $$
declare
  target public.tryouts%rowtype;
  target_division_id uuid;
  created_session_id uuid;
  form_id uuid;
  form_version_id uuid;
  rubric_id uuid;
  rubric_version_id uuid;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select tryout.* into target
  from public.tryouts as tryout
  where tryout.organization_id=p_organization_id and tryout.id=p_tryout_id
  for update;
  if not found then return query select 'not_found'::text; return; end if;
  if target.status <> 'draft' then return query select 'not_draft'::text; return; end if;

  if p_step='basics' then
    if coalesce(trim(p_payload->>'name'),'')='' or coalesce(trim(p_payload->>'sport'),'')=''
      or coalesce(trim(p_payload->>'timezone'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    update public.tryouts as tryout
    set name=trim(p_payload->>'name'),sport=trim(p_payload->>'sport'),
      timezone=trim(p_payload->>'timezone'),
      registration_starts_at=(p_payload->>'registrationStartsAt')::timestamptz,
      registration_ends_at=(p_payload->>'registrationEndsAt')::timestamptz
    where tryout.id=target.id and tryout.organization_id=target.organization_id;
  elsif p_step='divisions' then
    if coalesce(trim(p_payload->>'name'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    insert into public.tryout_divisions(organization_id,tryout_id,name,sort_order)
    values(p_organization_id,p_tryout_id,trim(p_payload->>'name'),(
      select coalesce(max(division.sort_order),-1)+1
      from public.tryout_divisions as division
      where division.organization_id=p_organization_id and division.tryout_id=p_tryout_id
    ));
  elsif p_step='sessions' then
    target_division_id:=nullif(p_payload->>'divisionId','')::uuid;
    if target_division_id is null or coalesce(trim(p_payload->>'name'),'')=''
      or p_payload->>'startsAt' is null or p_payload->>'endsAt' is null then
      return query select 'invalid_input'::text; return;
    end if;
    insert into public.tryout_sessions(
      organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order
    ) values(
      p_organization_id,p_tryout_id,target_division_id,trim(p_payload->>'name'),
      (p_payload->>'startsAt')::timestamptz,(p_payload->>'endsAt')::timestamptz,
      (select coalesce(max(session.sort_order),-1)+1
       from public.tryout_sessions as session
       where session.organization_id=p_organization_id
         and session.tryout_id=p_tryout_id
         and session.division_id=target_division_id)
    ) returning id into created_session_id;
    if coalesce(trim(p_payload->>'groupName'),'')<>'' then
      insert into public.session_groups(organization_id,tryout_id,session_id,name,sort_order)
      values(p_organization_id,p_tryout_id,created_session_id,trim(p_payload->>'groupName'),0);
    end if;
    if coalesce(trim(p_payload->>'positionName'),'')<>'' then
      insert into public.tryout_positions(organization_id,tryout_id,name,sort_order)
      values(p_organization_id,p_tryout_id,trim(p_payload->>'positionName'),(
        select coalesce(max(position.sort_order),-1)+1
        from public.tryout_positions as position
        where position.organization_id=p_organization_id and position.tryout_id=p_tryout_id
      ));
    end if;
  elsif p_step='registration' then
    if coalesce(trim(p_payload->>'name'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    insert into public.registration_forms(organization_id,tryout_id,name)
    values(p_organization_id,p_tryout_id,trim(p_payload->>'name')) returning id into form_id;
    insert into public.registration_form_versions(
      organization_id,tryout_id,registration_form_id,version_number,schema
    ) values(
      p_organization_id,p_tryout_id,form_id,1,
      coalesce(p_payload->'schema','{"fields":[]}'::jsonb)
    ) returning id into form_version_id;
    perform public.select_tryout_registration_form_version(
      p_organization_id,p_tryout_id,form_version_id
    );
  elsif p_step='rubrics' then
    created_session_id:=nullif(p_payload->>'sessionId','')::uuid;
    if created_session_id is null or coalesce(trim(p_payload->>'name'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    insert into public.rubrics(organization_id,tryout_id,name)
    values(p_organization_id,p_tryout_id,trim(p_payload->>'name')) returning id into rubric_id;
    insert into public.rubric_versions(
      organization_id,tryout_id,rubric_id,version_number
    ) values(p_organization_id,p_tryout_id,rubric_id,1) returning id into rubric_version_id;
    insert into public.rubric_categories(
      organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max
    ) values(
      p_organization_id,p_tryout_id,rubric_version_id,
      coalesce(nullif(trim(p_payload->>'categoryName'),''),'Overall'),0,100,1,5
    );
    insert into public.session_rubrics(
      organization_id,tryout_id,session_id,rubric_version_id
    ) values(
      p_organization_id,p_tryout_id,created_session_id,rubric_version_id
    ) on conflict (organization_id,session_id)
      do update set rubric_version_id=excluded.rubric_version_id;
  else
    return query select 'invalid_input'::text; return;
  end if;
  return query select 'saved'::text;
end;
$$;

revoke all on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb)
  from public;
grant execute on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb)
  to authenticated;
