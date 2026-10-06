create table private.athlete_portraits (
 organization_id uuid not null,athlete_id uuid not null,content bytea not null,sha256 text not null,version integer not null default 1,updated_by uuid not null,updated_at timestamptz not null default now(),
 primary key(organization_id,athlete_id),foreign key(organization_id,athlete_id) references public.athletes(organization_id,id),
 check(octet_length(content) between 12 and 350000 and substring(content from 1 for 4)=decode('52494646','hex') and substring(content from 9 for 4)=decode('57454250','hex') and sha256=encode(extensions.digest(content,'sha256'),'hex'))
);
revoke all on private.athlete_portraits from public,anon,authenticated,service_role;
create function public.read_athlete_portrait(p_organization_id uuid,p_athlete_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 return (select jsonb_build_object('base64',encode(content,'base64'),'version',version) from private.athlete_portraits where organization_id=p_organization_id and athlete_id=p_athlete_id);
end;$$;
create function public.save_athlete_portrait(p_organization_id uuid,p_athlete_id uuid,p_base64 text,p_sha256 text,p_version integer) returns integer language plpgsql security definer set search_path='' as $$
declare actual integer;begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 if length(p_base64)>466668 then raise exception 'portrait too large' using errcode='23514'; end if;
 perform 1 from public.athletes where organization_id=p_organization_id and id=p_athlete_id for update;
 if not found then raise exception 'athlete unavailable' using errcode='23503'; end if;
 select version into actual from private.athlete_portraits where organization_id=p_organization_id and athlete_id=p_athlete_id;
 if coalesce(actual,0)<>p_version then raise exception 'portrait changed' using errcode='40001'; end if;
 insert into private.athlete_portraits(organization_id,athlete_id,content,sha256,version,updated_by) values(p_organization_id,p_athlete_id,decode(p_base64,'base64'),p_sha256,p_version+1,auth.uid()) on conflict(organization_id,athlete_id) do update set content=excluded.content,sha256=excluded.sha256,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(p_organization_id,auth.uid(),'athlete.portrait.updated','athlete',p_athlete_id);return p_version+1;
end;$$;
create function public.save_athlete_contact(p_organization_id uuid,p_athlete_id uuid,p_name text,p_email text,p_phone text,p_relationship text,p_guardian_id uuid default null,p_expected_updated_at timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;existing public.guardians%rowtype;begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 160 or p_email is null or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_email)>254 or length(p_phone)>80 or length(p_relationship) not between 1 and 80 then raise exception 'invalid contact' using errcode='23514'; end if;
 perform 1 from public.athletes where organization_id=p_organization_id and id=p_athlete_id for update;
 if not found then raise exception 'athlete unavailable' using errcode='23503'; end if;
 if p_guardian_id is not null then
  if not exists(select 1 from public.athlete_guardians where organization_id=p_organization_id and athlete_id=p_athlete_id and guardian_id=p_guardian_id) then raise exception 'contact unavailable' using errcode='23503'; end if;
  select * into existing from public.guardians where organization_id=p_organization_id and id=p_guardian_id for update;
  if existing.updated_at is distinct from p_expected_updated_at then raise exception 'contact changed' using errcode='40001'; end if;
  update public.guardians set name=trim(p_name),email=trim(p_email),normalized_email=lower(trim(p_email)),phone=nullif(trim(p_phone),''),updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_guardian_id;result:=p_guardian_id;
 else
  select * into existing from public.guardians where organization_id=p_organization_id and normalized_email=lower(trim(p_email));
  if found then result:=existing.id;else
   insert into public.guardians(organization_id,name,email,normalized_email,phone) values(p_organization_id,trim(p_name),trim(p_email),lower(trim(p_email)),nullif(trim(p_phone),'')) returning id into result;
  end if;
 end if;
 insert into public.athlete_guardians(organization_id,athlete_id,guardian_id,relationship_label,is_primary_contact,communication_permitted) values(p_organization_id,p_athlete_id,result,p_relationship,false,false) on conflict(organization_id,athlete_id,guardian_id) do update set relationship_label=excluded.relationship_label;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(p_organization_id,auth.uid(),'athlete.contact.saved','athlete',p_athlete_id);return result;
end;$$;
revoke all on function public.read_athlete_portrait(uuid,uuid),public.save_athlete_portrait(uuid,uuid,text,text,integer),public.save_athlete_contact(uuid,uuid,text,text,text,text,uuid,timestamptz) from public,anon,service_role;
grant execute on function public.read_athlete_portrait(uuid,uuid),public.save_athlete_portrait(uuid,uuid,text,text,integer),public.save_athlete_contact(uuid,uuid,text,text,text,text,uuid,timestamptz) to authenticated;
