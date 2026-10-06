-- Invitation secrets remain private; managers can read a bounded display projection.
create function public.list_organization_invitations(
  p_organization_id uuid,
  p_limit integer default 25,
  p_offset integer default 0
) returns table(
  id uuid,
  email text,
  role text,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.organization_members member
    where member.organization_id=p_organization_id and member.user_id=auth.uid()
      and member.status='active' and member.role in('owner','administrator')
  ) then
    raise insufficient_privilege using message='invitation history access denied';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100
    or p_offset is null or p_offset<0 or p_offset>10000
  then
    raise invalid_parameter_value using message='invalid invitation history page';
  end if;
  return query
    select invitation.id,invitation.email::text,invitation.role,invitation.expires_at,
      invitation.accepted_at,invitation.revoked_at,invitation.created_at
    from public.organization_invitations invitation
    where invitation.organization_id=p_organization_id
    order by invitation.created_at desc,invitation.id desc
    limit p_limit offset p_offset;
end;
$$;

create index organization_invitations_history_idx
  on public.organization_invitations(organization_id,created_at desc,id desc);

revoke all on function public.list_organization_invitations(uuid,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_organization_invitations(uuid,integer,integer) to authenticated;
