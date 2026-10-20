revoke all privileges on function public.upsert_organization_logo(uuid,text,text)
  from public,anon,authenticated,service_role;

create function public.upsert_organization_logo_service(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_content_base64 text,
  p_sha256 text
) returns text
language plpgsql volatile security definer set search_path=''
as $$
declare
  decoded_content bytea;
  decoded_byte_length integer;
begin
  if p_actor_user_id is null
    or not exists(
      select 1
      from public.organization_members membership
      where membership.organization_id=p_organization_id
        and membership.user_id=p_actor_user_id
        and membership.status='active'
        and membership.role in('owner','administrator')
    )
  then return 'forbidden'; end if;

  if p_content_base64 is null or char_length(p_content_base64)>466668
    or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$'
  then raise invalid_parameter_value using message='invalid organization logo'; end if;

  begin
    decoded_content:=decode(p_content_base64,'base64');
  exception when others then
    raise invalid_parameter_value using message='invalid organization logo';
  end;
  decoded_byte_length:=octet_length(decoded_content);

  if decoded_byte_length not between 12 and 350000
    or substring(decoded_content from 1 for 4)<>decode('52494646','hex')
    or substring(decoded_content from 9 for 4)<>decode('57454250','hex')
    or encode(extensions.digest(decoded_content,'sha256'),'hex')<>p_sha256
  then raise invalid_parameter_value using message='invalid organization logo'; end if;

  perform 1 from public.organizations organization
  where organization.id=p_organization_id for update;
  if not found then return 'not_found'; end if;

  perform 1 from public.organization_members membership
  where membership.organization_id=p_organization_id
    and membership.user_id=p_actor_user_id
    and membership.status='active'
    and membership.role in('owner','administrator')
  for update;
  if not found then return 'forbidden'; end if;

  insert into private.organization_brand_assets(
    organization_id,content,content_type,byte_length,sha256,updated_by_user_id
  ) values(
    p_organization_id,decoded_content,'image/webp',decoded_byte_length,p_sha256,p_actor_user_id
  )
  on conflict(organization_id) do update set
    content=excluded.content,
    content_type=excluded.content_type,
    byte_length=excluded.byte_length,
    sha256=excluded.sha256,
    updated_by_user_id=excluded.updated_by_user_id,
    updated_at=clock_timestamp();

  insert into public.audit_logs(
    organization_id,actor_user_id,action,entity_type,entity_id,details
  ) values(
    p_organization_id,p_actor_user_id,'organization.logo_updated','organization_brand_asset',
    p_organization_id,jsonb_build_object('sha256',p_sha256,'byteLength',decoded_byte_length)
  );
  return 'updated';
end;
$$;

revoke all privileges on function public.upsert_organization_logo_service(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.upsert_organization_logo_service(uuid,uuid,text,text)
  to service_role;
