create table public.tryout_setup_progress (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  completed_steps text[] not null default '{}'::text[],
  last_step text not null default 'basics',
  updated_at timestamptz not null default clock_timestamp(),
  constraint tryout_setup_progress_organization_tryout_key unique (organization_id, tryout_id),
  constraint tryout_setup_progress_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete cascade,
  constraint tryout_setup_progress_steps_valid check (
    completed_steps <@ array['basics', 'divisions', 'sessions', 'registration', 'rubrics', 'review', 'publish']::text[]
    and last_step = any(array['basics', 'divisions', 'sessions', 'registration', 'rubrics', 'review', 'publish']::text[])
  )
);

alter table public.tryout_setup_progress enable row level security;

create policy tryout_setup_progress_select_authorized on public.tryout_setup_progress
for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id));

create function public.save_tryout_setup_step(p_organization_id uuid, p_tryout_id uuid, p_step text)
returns table (outcome text)
language plpgsql security definer set search_path = ''
as $$
declare target public.tryouts%rowtype;
begin
  if p_step not in ('basics', 'divisions', 'sessions', 'registration', 'rubrics', 'review', 'publish') then
    return query select 'not_draft'::text;
    return;
  end if;
  if not public.can_manage_tryout_root(p_organization_id, p_tryout_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select item.* into target from public.tryouts as item
  where item.organization_id = p_organization_id and item.id = p_tryout_id
  for update;
  if not found then return query select 'not_found'::text; return; end if;
  if target.status <> 'draft' then return query select 'not_draft'::text; return; end if;
  if p_step = 'divisions' and not exists (select 1 from public.tryout_divisions where organization_id = p_organization_id and tryout_id = p_tryout_id) then return query select 'invalid_step'::text; return; end if;
  if p_step = 'sessions' and not exists (select 1 from public.tryout_sessions where organization_id = p_organization_id and tryout_id = p_tryout_id) then return query select 'invalid_step'::text; return; end if;
  if p_step = 'registration' and not exists (select 1 from public.registration_form_versions where organization_id = p_organization_id and tryout_id = p_tryout_id) then return query select 'invalid_step'::text; return; end if;
  if p_step = 'rubrics' and exists (
    select 1 from public.tryout_sessions as session left join public.session_rubrics as binding on binding.organization_id = session.organization_id and binding.session_id = session.id
    where session.organization_id = p_organization_id and session.tryout_id = p_tryout_id and binding.id is null
  ) then return query select 'invalid_step'::text; return; end if;
  if p_step = 'review' and exists (select 1 from public.validate_tryout_for_publish(p_organization_id, p_tryout_id)) then return query select 'invalid_step'::text; return; end if;
  insert into public.tryout_setup_progress (organization_id, tryout_id, completed_steps, last_step)
  values (p_organization_id, p_tryout_id, array[p_step], p_step)
  on conflict (organization_id, tryout_id) do update
  set completed_steps = array(select distinct unnest(public.tryout_setup_progress.completed_steps || excluded.completed_steps)),
      last_step = excluded.last_step,
      updated_at = clock_timestamp();
  return query select 'saved'::text;
end;
$$;

revoke all on table public.tryout_setup_progress from public;
revoke all on function public.save_tryout_setup_step(uuid, uuid, text) from public;
grant execute on function public.save_tryout_setup_step(uuid, uuid, text) to authenticated;
