create or replace function public.prevent_organization_invitation_identity_mutation()
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

  if new.accepted_at is distinct from old.accepted_at
    or new.accepted_by_user_id is distinct from old.accepted_by_user_id then
    if current_setting('app.invitation_acceptance', true) is distinct from 'true' then
      raise exception 'invitation acceptance is reserved for the acceptance command' using errcode = '55000';
    end if;
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked invitation cannot be reactivated' using errcode = '55000';
  end if;

  return new;
end;
$$;

drop policy organization_invitations_insert_administrator on public.organization_invitations;

create policy organization_invitations_insert_administrator on public.organization_invitations
for insert to authenticated
with check (
  accepted_at is null
  and accepted_by_user_id is null
  and revoked_at is null
  and created_by_user_id = auth.uid()
  and public.is_active_organization_member(organization_id, array['owner', 'administrator'])
);

create or replace function public.accept_organization_invitation(p_token_digest text)
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
    where organization_members.organization_id = invitation.organization_id
      and organization_members.user_id = actor_id
  ) then
    return query select 'duplicate_membership'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.organization_members (organization_id, user_id, role, status)
  values (invitation.organization_id, actor_id, invitation.role, 'active');

  perform set_config('app.invitation_acceptance', 'true', true);
  update public.organization_invitations
  set accepted_at = now(), accepted_by_user_id = actor_id
  where id = invitation.id;

  select * into organization from public.organizations where id = invitation.organization_id;
  return query select 'accepted'::text, organization.id, organization.slug;
end;
$$;
