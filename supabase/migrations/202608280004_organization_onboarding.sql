alter table public.organizations
  add column terminology jsonb not null default '{"athlete":"Athlete","athletes":"Athletes"}'::jsonb,
  add column sport_defaults jsonb not null default '[]'::jsonb,
  add column tag_defaults jsonb not null default '[]'::jsonb,
  add constraint organizations_terminology_object check (jsonb_typeof(terminology) = 'object'),
  add constraint organizations_sport_defaults_array check (jsonb_typeof(sport_defaults) = 'array'),
  add constraint organizations_tag_defaults_array check (jsonb_typeof(tag_defaults) = 'array');

create function public.create_organization_with_owner(
  p_name text,
  p_slug text,
  p_timezone text,
  p_terminology jsonb,
  p_sport_defaults jsonb,
  p_tag_defaults jsonb
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  timezone text,
  terminology jsonb,
  sport_defaults jsonb,
  tag_defaults jsonb,
  owner_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_organization public.organizations%rowtype;
  actor_id uuid := auth.uid();
  normalized_slug text := regexp_replace(
    regexp_replace(lower(trim(p_slug)), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)',
    '',
    'g'
  );
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.is_valid_organization_slug(normalized_slug) then
    raise exception 'invalid organization slug' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, timezone, terminology, sport_defaults, tag_defaults)
  values (trim(p_name), normalized_slug, p_timezone, p_terminology, p_sport_defaults, p_tag_defaults)
  returning * into created_organization;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (created_organization.id, actor_id, 'owner', 'active');

  return query select
    created_organization.id,
    created_organization.name,
    created_organization.slug,
    created_organization.timezone,
    created_organization.terminology,
    created_organization.sport_defaults,
    created_organization.tag_defaults,
    actor_id;
end;
$$;

create function public.prevent_organization_invitation_identity_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id
    or new.email <> old.email
    or new.role <> old.role
    or new.token_digest <> old.token_digest
    or new.expires_at <> old.expires_at
    or new.created_by_user_id <> old.created_by_user_id then
    raise exception 'invitation identity is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger prevent_organization_invitation_identity_mutation
before update on public.organization_invitations
for each row
execute function public.prevent_organization_invitation_identity_mutation();

drop policy organization_invitations_manage_administrator on public.organization_invitations;

create policy organization_invitations_select_administrator on public.organization_invitations
for select to authenticated
using (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create policy organization_invitations_insert_administrator on public.organization_invitations
for insert to authenticated
with check (
  created_by_user_id = auth.uid()
  and public.is_active_organization_member(organization_id, array['owner', 'administrator'])
);

create policy organization_invitations_update_administrator on public.organization_invitations
for update to authenticated
using (public.is_active_organization_member(organization_id, array['owner', 'administrator']))
with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create function public.accept_organization_invitation(p_token_digest text)
returns table (outcome text, organization_id uuid, organization_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.organization_invitations%rowtype;
  organization public.organizations%rowtype;
  actor_id uuid := auth.uid();
  actor_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into invitation
  from public.organization_invitations
  where token_digest = p_token_digest
  for update;

  if not found or invitation.accepted_at is not null or invitation.revoked_at is not null then
    return query select 'invalid'::text, null::uuid, null::text;
    return;
  end if;

  if invitation.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text;
    return;
  end if;

  if actor_email = '' or lower(trim(invitation.email::text)) <> actor_email then
    return query select 'wrong_email'::text, null::uuid, null::text;
    return;
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id = invitation.organization_id and user_id = actor_id
  ) then
    return query select 'duplicate_membership'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (invitation.organization_id, actor_id, invitation.role, 'active');

  update public.organization_invitations
  set accepted_at = now(), accepted_by_user_id = actor_id
  where id = invitation.id;

  select * into organization from public.organizations where id = invitation.organization_id;
  return query select 'accepted'::text, organization.id, organization.slug;
end;
$$;

revoke all on function public.create_organization_with_owner(text, text, text, jsonb, jsonb, jsonb) from public;
revoke all on function public.accept_organization_invitation(text) from public;
revoke all on function public.create_organization_with_owner(text, text, text, jsonb, jsonb, jsonb) from anon;
revoke all on function public.accept_organization_invitation(text) from anon;
grant execute on function public.create_organization_with_owner(text, text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
