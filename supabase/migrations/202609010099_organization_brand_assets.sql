create table private.organization_brand_assets (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  content bytea not null,
  content_type text not null,
  byte_length integer not null,
  sha256 text not null,
  updated_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint organization_brand_assets_content_type_check
    check(content_type='image/webp'),
  constraint organization_brand_assets_byte_length_check
    check(byte_length=octet_length(content) and byte_length between 12 and 350000),
  constraint organization_brand_assets_webp_header_check
    check(
      substring(content from 1 for 4)=decode('52494646','hex')
      and substring(content from 9 for 4)=decode('57454250','hex')
    ),
  constraint organization_brand_assets_sha256_check
    check(
      sha256~'^[0-9a-f]{64}$'
      and sha256=encode(extensions.digest(content,'sha256'),'hex')
    )
);

alter table private.organization_brand_assets enable row level security;

create function private.prevent_organization_brand_asset_identity_change()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise object_not_in_prerequisite_state using message='organization logo identity is immutable';
  end if;
  return new;
end;
$$;

create trigger prevent_organization_brand_asset_identity_change
before update of organization_id on private.organization_brand_assets
for each row execute function private.prevent_organization_brand_asset_identity_change();
alter table private.organization_brand_assets
  enable always trigger prevent_organization_brand_asset_identity_change;

create function private.deny_organization_brand_assets_truncate()
returns trigger language plpgsql set search_path=''
as $$
begin
  raise object_not_in_prerequisite_state using message='organization logos cannot be truncated';
end;
$$;

create trigger deny_organization_brand_assets_truncate
before truncate on private.organization_brand_assets
for each statement execute function private.deny_organization_brand_assets_truncate();
alter table private.organization_brand_assets
  enable always trigger deny_organization_brand_assets_truncate;

create function public.upsert_organization_logo(
  p_organization_id uuid,
  p_content_base64 text,
  p_sha256 text
) returns text
language plpgsql volatile security definer set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  decoded_content bytea;
  decoded_byte_length integer;
begin
  if actor_id is null
    or not public.is_active_organization_member(
      p_organization_id,array['owner','administrator']
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
    and membership.user_id=actor_id
    and membership.status='active'
    and membership.role in('owner','administrator')
  for update;
  if not found then return 'forbidden'; end if;

  insert into private.organization_brand_assets(
    organization_id,content,content_type,byte_length,sha256,updated_by_user_id
  ) values(
    p_organization_id,decoded_content,'image/webp',decoded_byte_length,p_sha256,actor_id
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
    p_organization_id,actor_id,'organization.logo_updated','organization_brand_asset',
    p_organization_id,jsonb_build_object('sha256',p_sha256,'byteLength',decoded_byte_length)
  );
  return 'updated';
end;
$$;

create function public.remove_organization_logo(p_organization_id uuid)
returns text
language plpgsql volatile security definer set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  removed_sha256 text;
  removed_byte_length integer;
begin
  if actor_id is null
    or not public.is_active_organization_member(
      p_organization_id,array['owner','administrator']
    )
  then return 'forbidden'; end if;

  perform 1 from public.organizations organization
  where organization.id=p_organization_id for update;
  if not found then return 'not_found'; end if;

  perform 1 from public.organization_members membership
  where membership.organization_id=p_organization_id
    and membership.user_id=actor_id
    and membership.status='active'
    and membership.role in('owner','administrator')
  for update;
  if not found then return 'forbidden'; end if;

  delete from private.organization_brand_assets asset
  where asset.organization_id=p_organization_id
  returning asset.sha256,asset.byte_length into removed_sha256,removed_byte_length;
  if not found then return 'not_found'; end if;

  insert into public.audit_logs(
    organization_id,actor_user_id,action,entity_type,entity_id,details
  ) values(
    p_organization_id,actor_id,'organization.logo_removed','organization_brand_asset',
    p_organization_id,
    jsonb_build_object('sha256',removed_sha256,'byteLength',removed_byte_length)
  );
  return 'removed';
end;
$$;

create function public.read_organization_logo_service(p_organization_slug text)
returns table(
  content bytea,
  content_type text,
  byte_length integer,
  sha256 text,
  updated_at timestamptz
)
language sql stable security definer set search_path=''
as $$
  select asset.content,asset.content_type,asset.byte_length,asset.sha256,asset.updated_at
  from public.organizations organization
  join private.organization_brand_assets asset
    on asset.organization_id=organization.id
  where organization.slug=p_organization_slug
$$;

create function public.get_organization_logo_metadata(p_organization_id uuid)
returns table(logo_exists boolean,sha256 text,updated_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null
    or not public.is_active_organization_member(p_organization_id)
  then raise insufficient_privilege using message='forbidden'; end if;

  return query
  select asset.organization_id is not null,asset.sha256,asset.updated_at
  from (values(true)) singleton(anchor)
  left join private.organization_brand_assets asset
    on asset.organization_id=p_organization_id;
end;
$$;

alter default privileges for role postgres in schema public
  revoke all privileges on functions from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema private
  revoke all privileges on tables from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema private
  revoke all privileges on functions from public,anon,authenticated,service_role;

revoke all privileges on table private.organization_brand_assets
  from public,anon,authenticated,service_role;
revoke all privileges on function private.prevent_organization_brand_asset_identity_change()
  from public,anon,authenticated,service_role;
revoke all privileges on function private.deny_organization_brand_assets_truncate()
  from public,anon,authenticated,service_role;
revoke all privileges on function public.upsert_organization_logo(uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all privileges on function public.remove_organization_logo(uuid)
  from public,anon,authenticated,service_role;
revoke all privileges on function public.read_organization_logo_service(text)
  from public,anon,authenticated,service_role;
revoke all privileges on function public.get_organization_logo_metadata(uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.upsert_organization_logo(uuid,text,text) to authenticated;
grant execute on function public.remove_organization_logo(uuid) to authenticated;
grant execute on function public.get_organization_logo_metadata(uuid) to authenticated;
grant execute on function public.read_organization_logo_service(text) to service_role;
