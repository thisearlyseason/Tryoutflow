-- Distinguish a manager-requested revocation from a grant already invalidated by
-- offboarding. Only the former writes the staffing revocation audit event.

create or replace function public.revoke_evaluator_assignment(
  p_organization_id uuid,
  p_assignment_id uuid
) returns table(outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.tryout_staff_assignments%rowtype;
begin
  if auth.uid() is null then
    return query select 'forbidden'::text;
    return;
  end if;

  select * into target
  from public.tryout_staff_assignments as assignment
  where assignment.organization_id = p_organization_id
    and assignment.id = p_assignment_id
    and assignment.role = 'evaluator'
  for update;

  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  if not public.can_manage_evaluator_scope(
    target.organization_id,
    target.tryout_id,
    target.scope_kind,
    target.division_id,
    target.session_id,
    target.group_id
  ) then
    return query select 'forbidden'::text;
    return;
  end if;

  if target.revoked_at is not null then
    return query select 'already_revoked'::text;
    return;
  end if;

  update public.tryout_staff_assignments
  set revoked_at = clock_timestamp()
  where id = target.id;

  insert into public.audit_logs(
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    details
  ) values (
    target.organization_id,
    auth.uid(),
    'staffing.evaluator_revoked',
    'tryout_staff_assignment',
    target.id,
    jsonb_build_object('tryoutId', target.tryout_id, 'scopeKind', target.scope_kind)
  );

  return query select 'revoked'::text;
end;
$$;

revoke all on function public.revoke_evaluator_assignment(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_evaluator_assignment(uuid, uuid) to authenticated;
