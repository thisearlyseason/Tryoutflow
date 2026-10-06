-- Explicit ACLs: Supabase default table privileges must not permit destructive operations.
do $$declare t text;begin
 foreach t in array array['athlete_sport_profiles','evaluator_sport_profiles','performance_metrics','performance_results','scouting_records','tryout_stations','roster_scenarios','roster_scenario_members'] loop
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update on public.%I to authenticated',t);
 end loop;
end;$$;
revoke all on public.scouting_grants from public,anon,authenticated;
grant select,insert,delete on public.scouting_grants to authenticated;
alter table public.performance_results add constraint finite_ratio check(numerator is null or (numerator::text not in ('NaN','Infinity','-Infinity') and denominator::text not in ('NaN','Infinity','-Infinity') and numerator<=1000000000 and denominator<=1000000000 and numerator=trunc(numerator) and denominator=trunc(denominator)));
alter table public.performance_metrics add constraint finite_bounds check((minimum is null or minimum::text not in ('NaN','Infinity','-Infinity')) and (maximum is null or maximum::text not in ('NaN','Infinity','-Infinity')));
create function public.scouting_approval_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and tg_op='UPDATE' and (old.status='approved' or old.visibility='athlete') and not public.is_active_organization_member(old.organization_id,array['owner','administrator']) then raise exception 'organizer must revise approved feedback' using errcode='42501'; end if;
 if new.visibility='athlete' and new.status<>'approved' then raise exception 'only approved feedback can be shared with an athlete' using errcode='23514'; end if;
 return new;
end;$$;
create trigger scouting_approval before insert or update on public.scouting_records for each row execute function public.scouting_approval_guard();
create function public.station_schedule_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Serialize all schedule changes for an event so two concurrent edits cannot double-book staff or groups.
 perform pg_advisory_xact_lock(hashtextextended(new.tryout_id::text,19));
 if exists(select 1 from public.tryout_stations s where s.organization_id=new.organization_id and s.tryout_id=new.tryout_id and s.id<>new.id and s.starts_at<new.ends_at and s.ends_at>new.starts_at and ((new.evaluator_user_id is not null and s.evaluator_user_id=new.evaluator_user_id) or (length(trim(new.group_label))>0 and lower(trim(s.group_label))=lower(trim(new.group_label))))) then raise exception 'staff or group has an overlapping station' using errcode='23P01'; end if;
 return new;
end;$$;
create trigger station_schedule before insert or update on public.tryout_stations for each row execute function public.station_schedule_guard();
create function public.scenario_approval_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.roster_scenarios%rowtype;begin
 if tg_table_name='roster_scenarios' then
  if new.status='approved' and (length(trim(new.rationale))=0 or not exists(select 1 from public.roster_scenario_members where organization_id=new.organization_id and scenario_id=new.id) or (select count(*) from public.roster_scenario_members where organization_id=new.organization_id and scenario_id=new.id and response<>'declined')>new.target_size) then raise exception 'approval requires rationale and members within target' using errcode='23514'; end if;
 else
  select * into strict s from public.roster_scenarios where organization_id=new.organization_id and id=new.scenario_id for update;
  if s.status in ('approved','archived') and (tg_op='INSERT' or new.role<>old.role or new.rationale<>old.rationale) then raise exception 'reopen the scenario before changing selections' using errcode='23514'; end if;
  if new.response in ('accepted','declined') and s.status<>'approved' then raise exception 'approve the scenario before recording an offer response' using errcode='23514'; end if;
 end if;
 return new;
end;$$;
create trigger scenario_approval before insert or update on public.roster_scenarios for each row execute function public.scenario_approval_guard();
create trigger scenario_member_approval before insert or update on public.roster_scenario_members for each row execute function public.scenario_approval_guard();
-- A single database transaction validates and imports the entire batch. Stable IDs allow safe retry.
create function public.import_performance_results(p_organization_id uuid,p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare r jsonb;existing public.performance_results%rowtype;n integer:=0;begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'import 1 to 500 rows' using errcode='23514'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  select * into existing from public.performance_results where id=(r->>'id')::uuid;
  if found then
   if existing.organization_id<>p_organization_id or existing.created_by<>auth.uid() or existing.athlete_id<>(r->>'athlete_id')::uuid or existing.metric_id<>(r->>'metric_id')::uuid or existing.measured_at<>(r->>'measured_at')::timestamptz or existing.trial<>(r->>'trial')::int or existing.status<>r->>'status' or existing.value is distinct from (r->>'value')::numeric or existing.numerator is distinct from (r->>'numerator')::numeric or existing.denominator is distinct from (r->>'denominator')::numeric or existing.source<>r->>'source' or existing.verified<>(r->>'verified')::boolean or existing.note<>r->>'note' or existing.session_id is distinct from (r->>'session_id')::uuid then raise exception 'retry differs from saved result' using errcode='23505'; end if;
  else
   insert into public.performance_results(id,organization_id,athlete_id,metric_id,session_id,value,numerator,denominator,status,trial,measured_at,source,verified,note,created_by)
   values((r->>'id')::uuid,p_organization_id,(r->>'athlete_id')::uuid,(r->>'metric_id')::uuid,(r->>'session_id')::uuid,(r->>'value')::numeric,(r->>'numerator')::numeric,(r->>'denominator')::numeric,r->>'status',(r->>'trial')::int,(r->>'measured_at')::timestamptz,r->>'source',(r->>'verified')::boolean,r->>'note',auth.uid());
  end if;n:=n+1;
 end loop;return n;
end;$$;
revoke all on function public.scouting_approval_guard(),public.station_schedule_guard(),public.scenario_approval_guard() from public,anon,authenticated;
revoke all on function public.import_performance_results(uuid,jsonb) from public,anon;
grant execute on function public.import_performance_results(uuid,jsonb) to authenticated;
