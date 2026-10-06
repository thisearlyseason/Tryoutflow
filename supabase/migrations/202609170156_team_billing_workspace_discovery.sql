-- The child's immutable parent FK and membership trigger already validate this marker.
-- Avoid a second organizations relationship on organization_members: legacy PostgREST
-- clients embed organizations through organization_id without a relationship hint.
alter table public.organization_members drop constraint organization_members_inherited_from_organization_id_fkey;
