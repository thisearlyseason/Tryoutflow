create or replace function public.save_tryout_setup_step(p_organization_id uuid, p_tryout_id uuid, p_step text)
returns table (outcome text) language plpgsql security definer set search_path = '' as $$
declare target public.tryouts%rowtype;
begin
  if p_step not in ('basics','divisions','sessions','registration','rubrics','review','publish') then return query select 'invalid_step'::text; return; end if;
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into target from public.tryouts where organization_id=p_organization_id and id=p_tryout_id for update;
  if not found then return query select 'not_found'::text; return; end if;
  if target.status <> 'draft' then return query select 'not_draft'::text; return; end if;
  if p_step='divisions' and not exists (select 1 from public.tryout_divisions where organization_id=p_organization_id and tryout_id=p_tryout_id) then return query select 'invalid_step'::text; return; end if;
  if p_step='sessions' and not exists (select 1 from public.tryout_sessions where organization_id=p_organization_id and tryout_id=p_tryout_id) then return query select 'invalid_step'::text; return; end if;
  if p_step='registration' and not exists (select 1 from public.registration_form_versions where organization_id=p_organization_id and tryout_id=p_tryout_id) then return query select 'invalid_step'::text; return; end if;
  if p_step='rubrics' and exists (select 1 from public.tryout_sessions s left join public.session_rubrics r on r.organization_id=s.organization_id and r.session_id=s.id where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and r.id is null) then return query select 'invalid_step'::text; return; end if;
  if p_step='review' and exists (select 1 from public.validate_tryout_for_publish(p_organization_id,p_tryout_id)) then return query select 'invalid_step'::text; return; end if;
  insert into public.tryout_setup_progress (organization_id,tryout_id,completed_steps,last_step) values (p_organization_id,p_tryout_id,array[p_step],p_step)
  on conflict (organization_id,tryout_id) do update set
    completed_steps = array(select allowed.step from unnest(array['basics','divisions','sessions','registration','rubrics','review','publish']) with ordinality as allowed(step,position) where allowed.step=any(public.tryout_setup_progress.completed_steps || excluded.completed_steps) order by allowed.position),
    last_step=excluded.last_step, updated_at=clock_timestamp();
  return query select 'saved'::text;
end;
$$;
