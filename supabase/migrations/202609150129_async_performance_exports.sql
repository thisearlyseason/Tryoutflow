create table private.performance_exports (
 id uuid primary key,organization_id uuid not null references public.organizations(id),user_id uuid not null references auth.users(id),
 state text not null default 'queued' check(state in ('queued','ready','failed')),filters jsonb not null default '{}',
 content text, row_count integer,message text not null default '',created_at timestamptz not null default now(),completed_at timestamptz,expires_at timestamptz not null default now()+interval '24 hours',
 check(content is null or octet_length(content)<=20971520)
);
revoke all on private.performance_exports from public,anon,authenticated,service_role;
create function private.performance_csv_cell(v text) returns text language sql immutable set search_path='' as $$
 select '"'||replace(case when coalesce(v,'') ~ ('^[[:space:][:cntrl:]'||U&'\FEFF'||']*[=+@-]') then ''''||v else coalesce(v,'') end,'"','""')||'"';
$$;
create function public.start_performance_export(p_organization_id uuid,p_id uuid,p_filters jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 if jsonb_typeof(p_filters)<>'object' or (p_filters-'from'-'to'-'session'-'metric')<>'{}'::jsonb then raise exception 'invalid export filters' using errcode='23514'; end if;
 if (select count(*) from private.performance_exports where user_id=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'export request limit reached' using errcode='54000'; end if;
 delete from private.performance_exports where user_id=auth.uid() and expires_at<now();
 insert into private.performance_exports(id,organization_id,user_id,filters) values(p_id,p_organization_id,auth.uid(),p_filters);
 return p_id;
end;$$;
create function public.build_performance_export(p_organization_id uuid,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare job private.performance_exports%rowtype;body text;total integer;begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 select * into strict job from private.performance_exports where organization_id=p_organization_id and id=p_id and user_id=auth.uid() and expires_at>now() for update;
 if job.state='ready' then return true;end if;
 begin
 with selected as materialized (
  select r.*,a.given_name||' '||a.family_name athlete,m.name metric,m.unit,m.protocol,m.sport from public.performance_results r join public.athletes a on a.organization_id=r.organization_id and a.id=r.athlete_id join public.performance_metrics m on m.organization_id=r.organization_id and m.id=r.metric_id
  where r.organization_id=p_organization_id and (nullif(job.filters->>'from','') is null or r.measured_at>=(job.filters->>'from')::date) and (nullif(job.filters->>'to','') is null or r.measured_at<((job.filters->>'to')::date+1)) and (nullif(job.filters->>'session','') is null or r.session_id=(job.filters->>'session')::uuid) and (nullif(job.filters->>'metric','') is null or r.metric_id=(job.filters->>'metric')::uuid)
  order by r.measured_at,r.id limit 50001
 ) select count(*),string_agg(array_to_string(array[
 private.performance_csv_cell(athlete_id::text),private.performance_csv_cell(athlete),private.performance_csv_cell(metric),private.performance_csv_cell(sport),private.performance_csv_cell(unit),private.performance_csv_cell(protocol),private.performance_csv_cell(value::text),private.performance_csv_cell(numerator::text),private.performance_csv_cell(denominator::text),private.performance_csv_cell(status),private.performance_csv_cell(trial::text),private.performance_csv_cell(to_char(measured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),private.performance_csv_cell(source),private.performance_csv_cell(verified::text),private.performance_csv_cell(note)
 ],','),E'\r\n' order by measured_at,id) into total,body from selected;
 if total>50000 then raise exception 'Export exceeds 50,000 trials. Narrow the date or session filter.';end if;
 body:='athlete_id,athlete,metric,sport,unit,protocol,value,successes,attempts,status,trial,measured_at,source,verified,note'||E'\r\n'||coalesce(body||E'\r\n','');
 if octet_length(body)>20971520 then raise exception 'Export exceeds 20 MB. Narrow the date or session filter.';end if;
 update private.performance_exports set state='ready',content=body,row_count=total,message='',completed_at=now() where id=p_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(p_organization_id,auth.uid(),'performance.export.ready','performance_export',p_id);return true;
 exception when others then update private.performance_exports set state='failed',message=case when sqlerrm like 'Export exceeds%' then sqlerrm else 'Export could not be generated. Review filters and retry.' end,completed_at=now() where id=p_id;return false;end;
end;$$;
create function public.performance_export_status(p_organization_id uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 return (select jsonb_build_object('state',state,'rows',row_count,'message',message,'expires_at',expires_at,'created_at',created_at) from private.performance_exports where organization_id=p_organization_id and id=p_id and user_id=auth.uid() and expires_at>now());
end;$$;
create function public.download_performance_export(p_organization_id uuid,p_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_use_talent(p_organization_id) then raise exception 'scouting access required' using errcode='42501'; end if;
 return (select content from private.performance_exports where organization_id=p_organization_id and id=p_id and user_id=auth.uid() and state='ready' and expires_at>now());
end;$$;
revoke all on function private.performance_csv_cell(text) from public,anon,authenticated,service_role;
revoke all on function public.start_performance_export(uuid,uuid,jsonb),public.build_performance_export(uuid,uuid),public.performance_export_status(uuid,uuid),public.download_performance_export(uuid,uuid) from public,anon,service_role;
grant execute on function public.start_performance_export(uuid,uuid,jsonb),public.build_performance_export(uuid,uuid),public.performance_export_status(uuid,uuid),public.download_performance_export(uuid,uuid) to authenticated;
