create or replace function public.prevent_published_rubric_category_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_version public.rubric_versions%rowtype;
  target_organization_id uuid;
  target_tryout_id uuid;
  target_version_id uuid;
begin
  if tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
    target_tryout_id := old.tryout_id;
    target_version_id := old.rubric_version_id;
  else
    target_organization_id := new.organization_id;
    target_tryout_id := new.tryout_id;
    target_version_id := new.rubric_version_id;
  end if;

  if tg_op = 'UPDATE' and (
    old.organization_id is distinct from new.organization_id
    or old.tryout_id is distinct from new.tryout_id
    or old.rubric_version_id is distinct from new.rubric_version_id
  ) then
    raise exception 'rubric category identity is immutable' using errcode = '23514';
  end if;

  select version.* into parent_version
  from public.rubric_versions as version
  where version.organization_id = target_organization_id
    and version.tryout_id = target_tryout_id
    and version.id = target_version_id
  for update;

  if parent_version.status = 'published' then
    raise exception 'published rubric categories are immutable' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger z_prevent_published_rubric_category_mutation on public.rubric_categories;

create trigger z_prevent_published_rubric_category_mutation
before insert or update or delete on public.rubric_categories
for each row execute function public.prevent_published_rubric_category_mutation();
