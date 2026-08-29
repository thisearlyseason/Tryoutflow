create table public.tryout_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  registration_form_version_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint tryout_publications_organization_id_id_key unique (organization_id, id),
  constraint tryout_publications_tryout_key unique (organization_id, tryout_id),
  constraint tryout_publications_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete restrict,
  constraint tryout_publications_form_version_fkey foreign key (organization_id, tryout_id, registration_form_version_id)
    references public.registration_form_versions (organization_id, tryout_id, id) on delete restrict
);

alter table public.tryout_publications enable row level security;

create function public.prevent_tryout_publication_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'tryout publication bindings are immutable' using errcode = '55000';
end;
$$;

create trigger prevent_tryout_publication_update
before update or delete on public.tryout_publications
for each row execute function public.prevent_tryout_publication_mutation();

create function public.validate_tryout_for_publish(p_organization_id uuid, p_tryout_id uuid)
returns table (blocker text)
language plpgsql security definer set search_path = ''
as $$
declare
  target public.tryouts%rowtype;
begin
  if not public.can_manage_tryout_root(p_organization_id, p_tryout_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select item.* into target from public.tryouts as item
  where item.organization_id = p_organization_id and item.id = p_tryout_id;
  if not found then return; end if;
  if not exists (select 1 from public.tryout_divisions where organization_id = p_organization_id and tryout_id = p_tryout_id) then
    return query select 'division_missing'::text;
  end if;
  if not exists (select 1 from public.tryout_sessions where organization_id = p_organization_id and tryout_id = p_tryout_id) then
    return query select 'session_missing'::text;
  end if;
  if not exists (select 1 from public.registration_form_versions where organization_id = p_organization_id and tryout_id = p_tryout_id) then
    return query select 'form_missing'::text;
  end if;
  if target.registration_starts_at is null or target.registration_ends_at is null or target.registration_ends_at <= clock_timestamp() then
    return query select 'registration_closed'::text;
  end if;
  if exists (
    select 1 from public.tryout_sessions as session
    left join public.session_rubrics as binding
      on binding.organization_id = session.organization_id and binding.tryout_id = session.tryout_id and binding.session_id = session.id
    left join public.rubric_versions as rubric_version
      on rubric_version.organization_id = binding.organization_id and rubric_version.tryout_id = binding.tryout_id and rubric_version.id = binding.rubric_version_id
    where session.organization_id = p_organization_id and session.tryout_id = p_tryout_id
      and (binding.id is null or rubric_version.status <> 'published')
  ) or exists (
    select 1 from public.session_rubrics as binding
    where binding.organization_id = p_organization_id and binding.tryout_id = p_tryout_id
      and coalesce((select sum(category.weight) from public.rubric_categories as category where category.organization_id = binding.organization_id and category.tryout_id = binding.tryout_id and category.rubric_version_id = binding.rubric_version_id), 0) <> 100
  ) then
    return query select 'rubric_invalid'::text;
  end if;
end;
$$;

create function public.publish_tryout(p_organization_id uuid, p_tryout_id uuid, p_expected_version integer)
returns table (outcome text, public_slug text)
language plpgsql security definer set search_path = ''
as $$
declare
  target public.tryouts%rowtype;
  form_version public.registration_form_versions%rowtype;
  validation_blocker text;
begin
  if not public.can_manage_tryout_root(p_organization_id, p_tryout_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select item.* into target from public.tryouts as item
  where item.organization_id = p_organization_id and item.id = p_tryout_id
  for update;
  if not found then return query select 'not_found'::text, null::text; return; end if;
  if target.status = 'published' then return query select 'already_published'::text, target.slug; return; end if;
  if target.status <> 'draft' or target.version <> p_expected_version then return query select 'conflict'::text, null::text; return; end if;

  select check_result.blocker into validation_blocker
  from public.validate_tryout_for_publish(p_organization_id, p_tryout_id) as check_result
  limit 1;
  if validation_blocker is not null then return query select validation_blocker, null::text; return; end if;

  select version.* into form_version
  from public.registration_form_versions as version
  where version.organization_id = p_organization_id and version.tryout_id = p_tryout_id
  order by version.version_number desc, version.created_at desc
  limit 1
  for update;
  if not found then return query select 'form_missing'::text, null::text; return; end if;

  if form_version.status = 'draft' then
    update public.registration_form_versions
    set status = 'published', published_at = clock_timestamp()
    where id = form_version.id and organization_id = form_version.organization_id and status = 'draft';
  end if;

  update public.tryouts
  set status = 'published', published_at = clock_timestamp()
  where organization_id = target.organization_id and id = target.id and version = p_expected_version;
  if not found then return query select 'conflict'::text, null::text; return; end if;

  insert into public.tryout_publications (organization_id, tryout_id, registration_form_version_id)
  values (target.organization_id, target.id, form_version.id);
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id)
  values (target.organization_id, auth.uid(), 'tryout.published', 'tryout', target.id);
  return query select 'published'::text, target.slug;
end;
$$;

revoke all on table public.tryout_publications from public;
revoke all on function public.validate_tryout_for_publish(uuid, uuid) from public;
revoke all on function public.publish_tryout(uuid, uuid, integer) from public;
grant execute on function public.validate_tryout_for_publish(uuid, uuid) to authenticated;
grant execute on function public.publish_tryout(uuid, uuid, integer) to authenticated;
