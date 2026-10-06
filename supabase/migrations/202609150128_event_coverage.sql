create function public.event_coverage(p_organization_id uuid,p_tryout_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;begin
 if not public.is_active_organization_member(p_organization_id) then raise exception 'membership required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('athlete_id',x.athlete_id,'registration_id',x.registration_id,'name',x.name,'session_id',x.session_id,'session',x.session,'group',x.group_name,'starts_at',x.starts_at,'ends_at',x.ends_at,'checked_in_at',x.checked_in_at,
 'evaluators',(select coalesce(jsonb_agg(jsonb_build_object('user_id',staff.user_id,'name',coalesce(profile.display_name,base.display_name,'Evaluator'),'state',coalesce(e.state,'not_started'),'updated_at',e.updated_at,'evaluation_id',e.id,'latest_sync_outcome',(select m.outcome from public.evaluation_mutations m where m.organization_id=p_organization_id and m.evaluation_id=e.id and m.actor_user_id=staff.user_id order by m.created_at desc limit 1)) order by staff.user_id),'[]')
 from (select distinct a.user_id from public.tryout_staff_assignments a where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and private.ranking_assignment_matches(a.id,p_organization_id,p_tryout_id,x.division_id,x.session_id,x.group_id,x.athlete_id,'evaluator')) staff
 left join public.evaluator_sport_profiles profile on profile.organization_id=p_organization_id and profile.user_id=staff.user_id
 left join public.profiles base on base.id=staff.user_id
 left join lateral (select ev.id,ev.state,ev.updated_at from public.evaluations ev where ev.organization_id=p_organization_id and ev.tryout_id=p_tryout_id and ev.tryout_session_id=x.session_id and ev.tryout_registration_id=x.registration_id and ev.group_id is not distinct from x.group_id and ev.evaluator_user_id=staff.user_id order by ev.updated_at desc limit 1) e on true)
 ) order by x.starts_at,x.name),'[]') into rows from (
 select r.id registration_id,r.athlete_id,r.division_id,a.given_name||' '||a.family_name name,se.session_id,se.group_id,s.name session,g.name group_name,s.starts_at,s.ends_at,
 (select c.checked_in_at from public.checkins c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.registration_id=r.id and c.session_id=se.session_id and c.reversed_at is null order by c.checked_in_at desc limit 1) checked_in_at
 from public.tryout_registrations r join public.athletes a on a.organization_id=r.organization_id and a.id=r.athlete_id join public.session_enrollments se on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id and se.registration_id=r.id join public.tryout_sessions s on s.organization_id=se.organization_id and s.id=se.session_id left join public.session_groups g on g.organization_id=se.organization_id and g.id=se.group_id
 where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.status='submitted' and private.can_read_ranking_registration(r.organization_id,r.tryout_id,r.division_id,se.session_id,se.group_id,r.athlete_id) order by s.starts_at,r.id limit 10001
 ) x;
 if jsonb_array_length(rows)>10000 then raise exception 'event coverage exceeds 10000 placements' using errcode='23514'; end if;
 return rows;
end;$$;
revoke all on function public.event_coverage(uuid,uuid) from public,anon,service_role;
grant execute on function public.event_coverage(uuid,uuid) to authenticated;
