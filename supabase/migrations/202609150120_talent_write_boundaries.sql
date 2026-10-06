create table private.talent_record_revisions (
 id bigint generated always as identity primary key,organization_id uuid not null,record_table text not null,record_id uuid not null,version integer not null,record jsonb not null,actor_id uuid,recorded_at timestamptz not null default now(),unique(record_table,record_id,version)
);
revoke all on private.talent_record_revisions from public,anon,authenticated,service_role;
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
 if tg_table_name in ('tryout_stations','roster_scenarios','roster_scenario_members') and auth.uid() is not null and not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 if tg_table_name='scouting_records' and auth.uid() is not null and ((to_jsonb(new)->>'status')='approved' or (to_jsonb(new)->>'visibility')='athlete') and not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then raise exception 'organizer approval required' using errcode='42501'; end if;
 new.updated_at:=clock_timestamp();return new;
end;$$;
create function public.save_prospect_identity(p_organization_id uuid,p_id uuid,p_given_name text,p_family_name text,p_birth_date date,p_expected_updated_at timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare current_row public.athletes%rowtype;begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 if p_given_name is null or p_family_name is null or length(trim(p_given_name)) not between 1 and 120 or length(trim(p_family_name)) not between 1 and 120 or p_birth_date>current_date then raise exception 'invalid identity' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||lower(public.canonical_import_text(p_given_name))||lower(public.canonical_import_text(p_family_name))||coalesce(p_birth_date::text,''),0));
 if exists(select 1 from public.athletes where organization_id=p_organization_id and id<>p_id and normalized_given_name=lower(public.canonical_import_text(p_given_name)) and normalized_family_name=lower(public.canonical_import_text(p_family_name)) and birth_date is not distinct from p_birth_date) then raise exception 'review existing athlete' using errcode='23505'; end if;
 select * into current_row from public.athletes where organization_id=p_organization_id and id=p_id for update;
 if found then
  if p_expected_updated_at is null or current_row.updated_at<>p_expected_updated_at then raise exception 'identity changed' using errcode='40001'; end if;
  update public.athletes set given_name=public.canonical_import_text(p_given_name),family_name=public.canonical_import_text(p_family_name),birth_date=p_birth_date where organization_id=p_organization_id and id=p_id;
 else
  if p_expected_updated_at is not null then raise exception 'athlete unavailable' using errcode='23503'; end if;
  insert into public.athletes(id,organization_id,given_name,family_name,birth_date,normalized_given_name,normalized_family_name) values(p_id,p_organization_id,public.canonical_import_text(p_given_name),public.canonical_import_text(p_family_name),p_birth_date,'derived','derived');
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(p_organization_id,auth.uid(),'athlete.identity.saved','athlete',p_id);
 return p_id;
end;$$;
revoke all on function public.save_prospect_identity(uuid,uuid,text,text,date,timestamptz) from public,anon;
grant execute on function public.save_prospect_identity(uuid,uuid,text,text,date,timestamptz) to authenticated;
