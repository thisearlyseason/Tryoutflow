-- Athlete development and scouting extend the existing event records; no existing data is rewritten.
create table public.scouting_grants (
 organization_id uuid not null, user_id uuid not null, created_at timestamptz not null default now(),
 primary key(organization_id,user_id),
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id)
);
alter table public.scouting_grants enable row level security;
create policy scouting_grants_read on public.scouting_grants for select to authenticated using(user_id=auth.uid() or public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy scouting_grants_manage on public.scouting_grants for all to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator'])) with check(public.is_active_organization_member(organization_id,array['owner','administrator']));
grant select,insert,delete on public.scouting_grants to authenticated;
create function public.can_use_talent(p_organization_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_organization_member(p_organization_id,array['owner','administrator']) or
 (public.is_active_organization_member(p_organization_id) and exists(select 1 from public.scouting_grants g where g.organization_id=p_organization_id and g.user_id=auth.uid()));
$$;
revoke all on function public.can_use_talent(uuid) from public,anon;
grant execute on function public.can_use_talent(uuid) to authenticated;
create policy athletes_scout_read on public.athletes for select to authenticated using(public.can_use_talent(organization_id));

create table public.athlete_sport_profiles (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, athlete_id uuid not null,
 preferred_name text not null default '', sport text not null default '', primary_position text not null default '',
 secondary_positions text not null default '', current_team text not null default '', competitive_level text not null default '',
 dominant_side text not null default '', hometown text not null default '', biography text not null default '',
 tags text not null default '', stage text not null default 'identified' check(stage in ('identified','observe','follow_up','invited','evaluating','selected','monitor','closed')),
 version integer not null default 1 check(version>0), created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,athlete_id), unique(organization_id,id),
 foreign key(organization_id,athlete_id) references public.athletes(organization_id,id),
 check(length(preferred_name)<=120 and length(sport)<=80 and length(primary_position)<=120 and length(secondary_positions)<=300 and length(current_team)<=160 and length(competitive_level)<=120 and length(dominant_side)<=80 and length(hometown)<=160 and length(biography)<=4000 and length(tags)<=500)
);
create table public.evaluator_sport_profiles (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, user_id uuid not null,
 display_name text not null check(length(trim(display_name)) between 1 and 120), sport text not null default '',
 specialties text not null default '', qualifications text not null default '', experience text not null default '',
 availability text not null default '', conflict_disclosure text not null default '', briefing_complete boolean not null default false,
 version integer not null default 1 check(version>0), created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,user_id), unique(organization_id,id),
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id),
 check(length(sport)<=80 and length(specialties)<=500 and length(qualifications)<=2000 and length(experience)<=4000 and length(availability)<=2000 and length(conflict_disclosure)<=2000)
);
create table public.performance_metrics (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 name text not null check(length(trim(name)) between 1 and 120), sport text not null check(length(trim(sport)) between 1 and 80),
 unit text not null check(length(trim(unit)) between 1 and 30),
 value_kind text not null check(value_kind in ('decimal','duration','distance','speed','count','ratio')),
 direction text not null check(direction in ('higher','lower','neutral')),
 aggregation text not null default 'best' check(aggregation in ('best','mean','latest')),
 protocol text not null check(length(trim(protocol)) between 1 and 2000),
 minimum numeric, maximum numeric, version integer not null default 1 check(version>0),
 created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),unique(organization_id,sport,name,protocol),check(minimum is null or maximum is null or minimum<=maximum)
);
create table public.performance_results (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, athlete_id uuid not null, metric_id uuid not null,
 session_id uuid, value numeric, numerator numeric, denominator numeric,
 status text not null check(status in ('valid','invalid','not_observed','did_not_participate')),
 trial integer not null default 1 check(trial between 1 and 1000), measured_at timestamptz not null,
 source text not null check(length(trim(source)) between 1 and 300), verified boolean not null default false,
 note text not null default '' check(length(note)<=2000),
 version integer not null default 1 check(version>0),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id), foreign key(organization_id,athlete_id) references public.athletes(organization_id,id),
 foreign key(organization_id,metric_id) references public.performance_metrics(organization_id,id),
 foreign key(organization_id,session_id) references public.tryout_sessions(organization_id,id),
 check((status='valid' and value is not null) or (status<>'valid' and value is null and numerator is null and denominator is null)),
 check(value is null or (value::text not in ('NaN','Infinity','-Infinity') and abs(value)<=1000000000)),
 check((numerator is null and denominator is null) or (numerator>=0 and denominator>0 and numerator<=denominator)),
 unique(organization_id,athlete_id,metric_id,measured_at,trial)
);
create index performance_results_history on public.performance_results(organization_id,athlete_id,metric_id,measured_at desc);
-- Shared document structure for observations, follow-ups, evidence and development plans.
create table public.scouting_records (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, athlete_id uuid not null,
 kind text not null check(kind in ('report','task','video','goal','watchlist')),
 title text not null check(length(trim(title)) between 1 and 160), body text not null default '' check(length(body)<=8000),
 status text not null default 'draft' check(status in ('draft','active','in_review','approved','complete','archived')),
 visibility text not null default 'staff' check(visibility in ('private','staff','athlete')),
 observed_at timestamptz, due_on date, assigned_user_id uuid, source text not null default '' check(length(source)<=300),
 strengths text not null default '' check(length(strengths)<=4000), development_areas text not null default '' check(length(development_areas)<=4000),
 recommendation text not null default '' check(length(recommendation)<=2000),
 video_url text, start_seconds integer, end_seconds integer,
 version integer not null default 1 check(version>0),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,athlete_id) references public.athletes(organization_id,id),
 foreign key(organization_id,assigned_user_id) references public.organization_members(organization_id,user_id),
 check(video_url is null or (length(video_url)<=2000 and video_url ~ '^https://[^/[:space:]]+')),
 check(kind<>'video' or video_url is not null),
 check(start_seconds is null or start_seconds>=0),check(end_seconds is null or (start_seconds is not null and end_seconds>start_seconds))
);
create index scouting_records_work on public.scouting_records(organization_id,kind,status,due_on);
create index scouting_records_athlete on public.scouting_records(organization_id,athlete_id,created_at desc);

create table public.tryout_stations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, tryout_id uuid not null, session_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 120), location text not null default '', instructions text not null default '',
 starts_at timestamptz not null, ends_at timestamptz not null, capacity integer not null check(capacity between 1 and 1000),
 evaluator_user_id uuid, group_label text not null default '',
 version integer not null default 1 check(version>0),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,tryout_id,session_id) references public.tryout_sessions(organization_id,tryout_id,id),
 foreign key(organization_id,evaluator_user_id) references public.organization_members(organization_id,user_id),
 check(ends_at>starts_at),check(length(location)<=300 and length(instructions)<=4000 and length(group_label)<=160)
);
create table public.roster_scenarios (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, tryout_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 160), rationale text not null default '' check(length(rationale)<=8000),
 status text not null default 'draft' check(status in ('draft','in_review','approved','archived')),
 target_size integer not null default 20 check(target_size between 1 and 500),
 version integer not null default 1 check(version>0),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id)
);
create table public.roster_scenario_members (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,scenario_id uuid not null,athlete_id uuid not null,
 role text not null default '' check(length(role)<=120),rationale text not null default '' check(length(rationale)<=4000),
 response text not null default 'pending' check(response in ('pending','accepted','declined','waitlisted')),
 response_due date,version integer not null default 1 check(version>0),created_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),unique(organization_id,scenario_id,athlete_id),
 foreign key(organization_id,scenario_id) references public.roster_scenarios(organization_id,id),foreign key(organization_id,athlete_id) references public.athletes(organization_id,id)
);

create function public.talent_record_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
   if new.created_by is distinct from auth.uid() and auth.uid() is not null then raise exception 'invalid author' using errcode='42501'; end if;
   if new.version<>1 then raise exception 'invalid initial version' using errcode='23514'; end if;
 else
   if new.organization_id<>old.organization_id or new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'record identity cannot change' using errcode='23514'; end if;
   if new.version<>old.version+1 then raise exception 'refresh before saving this record' using errcode='40001'; end if;
 end if;
 new.updated_at:=clock_timestamp();
 return new;
end;$$;
create function public.talent_record_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
 values(new.organization_id,auth.uid(),'talent.'||tg_table_name||'.'||lower(tg_op),tg_table_name,new.id);
 return new;
end;$$;
create function public.performance_result_guard() returns trigger language plpgsql set search_path='' as $$
declare m public.performance_metrics%rowtype;
begin
 select * into strict m from public.performance_metrics where organization_id=new.organization_id and id=new.metric_id;
 if new.status='valid' then
  if m.value_kind='ratio' then
   if new.numerator is null or new.denominator is null then raise exception 'ratio requires attempts and successes' using errcode='23514'; end if;
   new.value:=round(new.numerator/new.denominator*100,6);
  elsif new.numerator is not null or new.denominator is not null then raise exception 'only ratio uses numerator' using errcode='23514'; end if;
  if (m.value_kind='count' and new.value<>trunc(new.value)) or (m.minimum is not null and new.value<m.minimum) or (m.maximum is not null and new.value>m.maximum) then raise exception 'measurement outside metric contract' using errcode='23514'; end if;
 end if;
 if new.measured_at>clock_timestamp()+interval '5 minutes' then raise exception 'measurement cannot be in the future' using errcode='23514'; end if;
 return new;
end;$$;
create trigger performance_result_contract before insert or update on public.performance_results for each row execute function public.performance_result_guard();
create function public.performance_metric_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.performance_results where organization_id=old.organization_id and metric_id=old.id) then raise exception 'create a new metric protocol after results have been recorded' using errcode='23514'; end if;
 return new;
end;$$;
create trigger performance_metric_contract before update on public.performance_metrics for each row execute function public.performance_metric_guard();

do $$declare t text;begin
 foreach t in array array['athlete_sport_profiles','performance_metrics','performance_results','scouting_records','tryout_stations','roster_scenarios','roster_scenario_members'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy talent_read on public.%I for select to authenticated using(public.can_use_talent(organization_id))',t);
 execute format('create policy talent_insert on public.%I for insert to authenticated with check(public.can_use_talent(organization_id) and created_by=auth.uid())',t);
 execute format('create policy talent_update on public.%I for update to authenticated using(public.can_use_talent(organization_id)) with check(public.can_use_talent(organization_id))',t);
 execute format('grant select,insert,update on public.%I to authenticated',t);
 end loop;
 foreach t in array array['athlete_sport_profiles','evaluator_sport_profiles','performance_metrics','performance_results','scouting_records','tryout_stations','roster_scenarios','roster_scenario_members'] loop
 execute format('create trigger talent_version before insert or update on public.%I for each row execute function public.talent_record_guard()',t);
 execute format('create trigger talent_audit after insert or update on public.%I for each row execute function public.talent_record_audit()',t);
 end loop;
end;$$;
-- Private scouting notes never become visible through broad manager/scout policies.
create policy scouting_private_boundary on public.scouting_records as restrictive for all to authenticated using(visibility<>'private' or created_by=auth.uid()) with check(visibility<>'private' or created_by=auth.uid());
alter table public.evaluator_sport_profiles enable row level security;
create policy evaluator_profile_read on public.evaluator_sport_profiles for select to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator']) or (user_id=auth.uid() and public.is_active_organization_member(organization_id)));
create policy evaluator_profile_write on public.evaluator_sport_profiles for all to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator']) or (user_id=auth.uid() and public.is_active_organization_member(organization_id))) with check(public.is_active_organization_member(organization_id,array['owner','administrator']) or (user_id=auth.uid() and public.is_active_organization_member(organization_id)));
grant select,insert,update on public.evaluator_sport_profiles to authenticated;
revoke all on function public.talent_record_guard(),public.talent_record_audit(),public.performance_result_guard(),public.performance_metric_guard() from public,anon,authenticated;
