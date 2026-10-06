-- Reviewers can read event results but deliberately cannot read setup configuration.
-- Lifecycle metadata is safe for every active event assignment, including reviewers.
do $$ declare source text; needle text:='if not public.can_read_tryout_configuration(p_organization_id,p_tryout_id) then'; begin
 select pg_get_functiondef('public.get_single_tryout_lifecycle(uuid,uuid)'::regprocedure) into source;
 if position(needle in source)=0 then raise exception 'lifecycle_visibility_contract_changed'; end if;
 execute replace(source,needle,$guard$if not (public.can_read_tryout_configuration(p_organization_id,p_tryout_id)
   or (public.is_active_organization_member(p_organization_id) and exists(
     select 1 from public.tryout_staff_assignments a where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id
       and a.user_id=auth.uid() and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())
   ))) then$guard$);
end $$;
