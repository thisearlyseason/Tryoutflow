create function public.list_performance_exports(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,'rows',row_count,'message',message,'created_at',created_at,'expires_at',expires_at) order by created_at desc),'[]') from (select * from private.performance_exports where organization_id=p_organization_id and user_id=auth.uid() and expires_at>now() order by created_at desc limit 20) jobs);
end;$$;
create function public.scouting_people(p_organization_id uuid) returns table(user_id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 return query select m.user_id,coalesce(nullif(e.display_name,''),nullif(p.display_name,''),'Staff member') from public.organization_members m left join public.profiles p on p.id=m.user_id left join public.evaluator_sport_profiles e on e.organization_id=m.organization_id and e.user_id=m.user_id where m.organization_id=p_organization_id and m.status='active';
end;$$;
revoke all on function public.list_performance_exports(uuid),public.scouting_people(uuid) from public,anon,service_role;
grant execute on function public.list_performance_exports(uuid),public.scouting_people(uuid) to authenticated;
