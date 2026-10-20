create function public.audit_scouting_grant() returns trigger language plpgsql security definer set search_path='' as $$
declare item public.scouting_grants%rowtype;begin
 item:=case when tg_op='DELETE' then old else new end;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(item.organization_id,auth.uid(),case when tg_op='DELETE' then 'scouting.access.revoked' else 'scouting.access.granted' end,'scouting_grant',item.user_id);
 return coalesce(new,old);
end;$$;
create trigger scouting_grant_audit after insert or delete on public.scouting_grants for each row execute function public.audit_scouting_grant();
create function public.revoke_scouting_on_offboarding() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'active' then delete from public.scouting_grants where organization_id=old.organization_id and user_id=old.user_id; end if;return new;
end;$$;
create trigger scouting_offboarding after update of status on public.organization_members for each row execute function public.revoke_scouting_on_offboarding();
revoke all on function public.audit_scouting_grant(),public.revoke_scouting_on_offboarding() from public,anon,authenticated,service_role;
