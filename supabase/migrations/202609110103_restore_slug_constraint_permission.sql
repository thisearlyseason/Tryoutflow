-- Organization updates run as the authenticated role under RLS. PostgreSQL
-- evaluates the slug CHECK constraint even when only settings are changed.
-- This immutable format validator reads no tenant records.
grant execute on function public.is_valid_organization_slug(text) to authenticated;
