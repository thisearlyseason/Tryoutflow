alter table public.tryout_stations add column status text not null default 'active' check(status in ('active','cancelled'));
create or replace function public.station_schedule_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare session public.tryout_sessions%rowtype;begin
 perform pg_advisory_xact_lock(hashtextextended(new.tryout_id::text,19));
 if new.status='cancelled' then return new;end if;
 select * into strict session from public.tryout_sessions where organization_id=new.organization_id and id=new.session_id;
 if new.starts_at<session.starts_at or new.ends_at>session.ends_at then raise exception 'station must be inside session times' using errcode='23514';end if;
 if exists(select 1 from public.tryout_stations s where s.organization_id=new.organization_id and s.tryout_id=new.tryout_id and s.id<>new.id and s.status='active' and s.starts_at<new.ends_at and s.ends_at>new.starts_at and ((new.evaluator_user_id is not null and s.evaluator_user_id=new.evaluator_user_id) or (length(trim(new.group_label))>0 and lower(trim(s.group_label))=lower(trim(new.group_label))))) then raise exception 'staff or group has an overlapping station' using errcode='23P01'; end if;
 if (select count(*) from public.session_enrollments e join public.session_groups g on g.organization_id=e.organization_id and g.id=e.group_id where e.organization_id=new.organization_id and e.session_id=new.session_id and lower(trim(g.name))=lower(trim(new.group_label)))>new.capacity then raise exception 'station capacity is below enrolled group size' using errcode='23514';end if;
 return new;
end;$$;
create or replace function public.talent_record_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare key text;begin
 if tg_op='INSERT' then
   if new.created_by is distinct from auth.uid() and auth.uid() is not null then raise exception 'invalid author' using errcode='42501'; end if;
   if new.version<>1 then raise exception 'invalid initial version' using errcode='23514'; end if;
 else
   foreach key in array array['organization_id','id','created_by','created_at','athlete_id','user_id','metric_id','scenario_id','tryout_id'] loop
    if to_jsonb(new)->key is distinct from to_jsonb(old)->key then raise exception 'record identity cannot change' using errcode='23514'; end if;
   end loop;
   if new.version<>old.version+1 then raise exception 'refresh before saving this record' using errcode='40001'; end if;
   insert into private.talent_record_revisions(organization_id,record_table,record_id,version,record,actor_id) values(old.organization_id,tg_table_name,old.id,old.version,to_jsonb(old),auth.uid());
 end if;
 if tg_table_name in ('tryout_stations','roster_scenarios','roster_scenario_members') and auth.uid() is not null and not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then
  if tg_table_name='roster_scenario_members' and tg_op='UPDATE' and public.can_view_participant(new.organization_id,(to_jsonb(new)->>'athlete_id')::uuid) and to_jsonb(old)->>'response'='pending' and to_jsonb(new)->>'response' in ('accepted','declined') and to_jsonb(new)->'role'=to_jsonb(old)->'role' and to_jsonb(new)->'rationale'=to_jsonb(old)->'rationale' and to_jsonb(new)->'response_due'=to_jsonb(old)->'response_due' then null;
  else raise exception 'organizer required' using errcode='42501';end if;
 end if;
 if tg_table_name='scouting_records' and auth.uid() is not null and ((to_jsonb(new)->>'status')='approved' or (to_jsonb(new)->>'visibility')='athlete') and not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then raise exception 'organizer approval required' using errcode='42501'; end if;
 new.updated_at:=clock_timestamp();return new;
end;$$;

create function public.participant_offers() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organization_id',m.organization_id,'scenario_id',m.scenario_id,'athlete_id',m.athlete_id,'team',s.name,'role',m.role,'response',m.response,'due_on',m.response_due)),'[]') from public.roster_scenario_members m join public.roster_scenarios s on s.organization_id=m.organization_id and s.id=m.scenario_id where s.status='approved' and public.can_view_participant(m.organization_id,m.athlete_id);
$$;
create function public.respond_to_offer(p_organization_id uuid,p_scenario_id uuid,p_athlete_id uuid,p_response text) returns boolean language plpgsql security definer set search_path='' as $$
declare member public.roster_scenario_members%rowtype;begin
 if not public.can_view_participant(p_organization_id,p_athlete_id) or p_response not in ('accepted','declined') then raise exception 'participant access required' using errcode='42501';end if;
 select * into strict member from public.roster_scenario_members where organization_id=p_organization_id and scenario_id=p_scenario_id and athlete_id=p_athlete_id for update;
 if member.response<>'pending' or (member.response_due is not null and member.response_due<current_date) then raise exception 'offer is no longer open' using errcode='23514';end if;
 update public.roster_scenario_members set response=p_response,version=version+1 where id=member.id;return true;
end;$$;
revoke all on function public.participant_offers(),public.respond_to_offer(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.participant_offers(),public.respond_to_offer(uuid,uuid,uuid,text) to authenticated;
