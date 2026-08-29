create trigger aa_lock_tryout_root_for_position before insert or update or delete on public.tryout_positions for each row execute function public.lock_tryout_root_for_configuration();
create trigger aa_lock_tryout_root_for_group before insert or update or delete on public.session_groups for each row execute function public.lock_tryout_root_for_configuration();

create table public.tryout_registration_form_selections (
  organization_id uuid not null,
  tryout_id uuid not null,
  registration_form_version_id uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, tryout_id),
  constraint tryout_registration_form_selections_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete cascade,
  constraint tryout_registration_form_selections_version_fkey foreign key (organization_id, tryout_id, registration_form_version_id)
    references public.registration_form_versions (organization_id, tryout_id, id) on delete restrict
);
alter table public.tryout_registration_form_selections enable row level security;

create function public.select_tryout_registration_form_version(p_organization_id uuid,p_tryout_id uuid,p_registration_form_version_id uuid)
returns table(outcome text) language plpgsql security definer set search_path='' as $$
declare target public.tryouts%rowtype;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into target from public.tryouts where organization_id=p_organization_id and id=p_tryout_id for update;
  if not found then return query select 'not_found'::text; return; end if;
  if target.status <> 'draft' then return query select 'not_draft'::text; return; end if;
  perform 1 from public.registration_form_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_form_version_id for update;
  if not found then return query select 'invalid_version'::text; return; end if;
  insert into public.tryout_registration_form_selections (organization_id,tryout_id,registration_form_version_id)
  values (p_organization_id,p_tryout_id,p_registration_form_version_id)
  on conflict (organization_id,tryout_id) do update set registration_form_version_id=excluded.registration_form_version_id,updated_at=clock_timestamp();
  return query select 'selected'::text;
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
  select version.* into form_version from public.tryout_registration_form_selections selection join public.registration_form_versions version on version.organization_id=selection.organization_id and version.tryout_id=selection.tryout_id and version.id=selection.registration_form_version_id where selection.organization_id=p_organization_id and selection.tryout_id=p_tryout_id for update of selection,version;
  form_exists:=found;
  perform 1 from public.rubric_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and id in (select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id) order by id for update;
  perform 1 from public.rubric_categories where organization_id=p_organization_id and tryout_id=p_tryout_id and rubric_version_id in (select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id) order by rubric_version_id,id for update;
  select blocker into validation_blocker from public.validate_tryout_for_publish(p_organization_id,p_tryout_id) limit 1;
  if validation_blocker is not null then return query select validation_blocker,null::text; return; end if;
  if not form_exists then return query select 'form_missing'::text,null::text; return; end if;
  update public.registration_form_versions set status='published',published_at=clock_timestamp() where id=form_version.id and organization_id=p_organization_id and status='draft';
  update public.rubric_versions set status='published',published_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and status='draft' and id in (select rubric_version_id from public.session_rubrics where organization_id=p_organization_id and tryout_id=p_tryout_id);
  update public.tryouts set status='published',published_at=clock_timestamp() where organization_id=p_organization_id and id=p_tryout_id and version=p_expected_version;
  if not found then return query select 'conflict'::text,null::text; return; end if;
  insert into public.tryout_publications (organization_id,tryout_id,registration_form_version_id) values (p_organization_id,p_tryout_id,form_version.id);
  insert into public.audit_logs (organization_id,actor_user_id,action,entity_type,entity_id) values (p_organization_id,auth.uid(),'tryout.published','tryout',p_tryout_id);
  return query select 'published'::text,target.slug;
end;
$$;

revoke all on table public.tryout_registration_form_selections from public;
revoke all on function public.select_tryout_registration_form_version(uuid,uuid,uuid) from public;
grant execute on function public.select_tryout_registration_form_version(uuid,uuid,uuid) to authenticated;
