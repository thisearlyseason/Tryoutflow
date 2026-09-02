drop function public.public_registration_tryout_v2(text);

create function public.public_registration_tryout_v2(p_tryout_slug text)
returns table(
  tryout_id uuid,
  name text,
  slug text,
  form_schema jsonb,
  divisions jsonb,
  positions jsonb,
  organization_name text,
  organization_slug text,
  logo_exists boolean
)
language sql stable security definer set search_path=''
as $$
  select
    target.id,
    target.name,
    target.slug,
    version.schema,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id',division.id,'name',division.name)
        order by division.sort_order,division.id
      )
      from public.tryout_divisions division
      where division.organization_id=target.organization_id
        and division.tryout_id=target.id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id',position.id,'name',position.name)
        order by position.sort_order,position.id
      )
      from public.tryout_positions position
      where position.organization_id=target.organization_id
        and position.tryout_id=target.id
    ),'[]'::jsonb),
    organization.name,
    organization.slug,
    asset.organization_id is not null
  from public.tryouts target
  join public.organizations organization
    on organization.id=target.organization_id
  join public.tryout_registration_form_selections selection
    on selection.organization_id=target.organization_id
    and selection.tryout_id=target.id
  join public.registration_form_versions version
    on version.organization_id=selection.organization_id
    and version.tryout_id=selection.tryout_id
    and version.id=selection.registration_form_version_id
    and version.status='published'
  left join private.organization_brand_assets asset
    on asset.organization_id=target.organization_id
  where target.slug=p_tryout_slug
    and target.status='published'
    and target.registration_starts_at<=clock_timestamp()
    and target.registration_ends_at>clock_timestamp()
$$;

revoke all privileges on function public.public_registration_tryout_v2(text)
  from public,anon,authenticated,service_role;
grant execute on function public.public_registration_tryout_v2(text) to service_role;
