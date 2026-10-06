-- Published registration schedules are public, even before/after the form accepts entries.
-- The form and submission RPCs retain their registration-window checks.
create function public.public_registration_window(p_tryout_slug text)
returns table(outcome text,name text,organization_name text,timezone text,
 registration_starts_at timestamptz,registration_ends_at timestamptz)
language sql stable security definer set search_path='' as $$
 select case when t.registration_starts_at>clock_timestamp() then 'scheduled' else 'closed' end,
   t.name,o.name,t.timezone,t.registration_starts_at,t.registration_ends_at
 from public.tryouts t join public.organizations o on o.id=t.organization_id
 join public.tryout_registration_form_selections s on s.organization_id=t.organization_id and s.tryout_id=t.id
 join public.registration_form_versions v on v.organization_id=s.organization_id and v.tryout_id=s.tryout_id and v.id=s.registration_form_version_id and v.status='published'
 where t.slug=p_tryout_slug and t.status='published'
   and t.registration_starts_at is not null and t.registration_ends_at is not null
   and (t.registration_starts_at>clock_timestamp() or t.registration_ends_at<=clock_timestamp());
$$;
revoke all on function public.public_registration_window(text) from public,anon,authenticated,service_role;
grant execute on function public.public_registration_window(text) to service_role;
