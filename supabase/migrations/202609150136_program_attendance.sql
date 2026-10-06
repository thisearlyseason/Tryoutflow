-- Aggregate attendance without granting access to private check-in receipts.
create function public.program_attendance(p_organization_id uuid) returns table(tryout_id uuid,placements bigint) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501';end if;
 return query select c.tryout_id,count(distinct (c.registration_id,c.session_id)) from public.checkins c where c.organization_id=p_organization_id and c.reversed_at is null group by c.tryout_id;
end;$$;
revoke all on function public.program_attendance(uuid) from public,anon,service_role;
grant execute on function public.program_attendance(uuid) to authenticated;
