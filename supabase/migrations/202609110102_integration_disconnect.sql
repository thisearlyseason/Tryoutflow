create or replace function public.disconnect_integration_connection(
  p_organization_id uuid,
  p_connection_id uuid
) returns text
language plpgsql
security definer
set search_path=''
as $$
declare target public.integration_connections%rowtype;
begin
  if not private.can_manage_integrations(p_organization_id) then return 'forbidden'; end if;
  select * into target from public.integration_connections
    where id=p_connection_id and organization_id=p_organization_id
    for update;
  if not found then return 'not_found'; end if;
  if target.state='disconnected' then return 'replayed'; end if;
  update public.integration_connections
    set state='disconnected', disconnected_at=clock_timestamp(), updated_at=clock_timestamp()
    where id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'integration.disconnected','integration_connection',target.id);
  return 'disconnected';
end;
$$;

revoke all on function public.disconnect_integration_connection(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.disconnect_integration_connection(uuid,uuid) to authenticated;
