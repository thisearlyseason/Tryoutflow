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
  if tg_table_name='roster_scenario_members' and tg_op='UPDATE' and public.can_view_participant(new.organization_id,(to_jsonb(new)->>'athlete_id')::uuid) and to_jsonb(old)->>'response'='pending' and to_jsonb(new)->>'response' in ('accepted','declined') and ((to_jsonb(old)->>'response_due') is null or (to_jsonb(old)->>'response_due')::date>=current_date) and to_jsonb(new)->'role'=to_jsonb(old)->'role' and to_jsonb(new)->'rationale'=to_jsonb(old)->'rationale' and to_jsonb(new)->'response_due'=to_jsonb(old)->'response_due' then null;
  else raise exception 'organizer required' using errcode='42501';end if;
 end if;
 if tg_table_name='scouting_records' and auth.uid() is not null and ((to_jsonb(new)->>'status')='approved' or (to_jsonb(new)->>'visibility')='athlete') and not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then raise exception 'organizer approval required' using errcode='42501'; end if;
 new.updated_at:=clock_timestamp();return new;
end;$$;
