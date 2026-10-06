create table public.calibration_cases (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),title text not null check(length(trim(title)) between 1 and 160),
 prompt text not null check(length(trim(prompt)) between 1 and 8000),rubric_guidance text not null check(length(trim(rubric_guidance)) between 1 and 4000),
 anchor_score integer not null check(anchor_score between 1 and 10),anchor_explanation text not null check(length(trim(anchor_explanation)) between 1 and 4000),active boolean not null default true,
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),unique(organization_id,id)
);
create table public.calibration_attempts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,case_id uuid not null,user_id uuid not null default auth.uid(),score integer not null check(score between 1 and 10),rationale text not null check(length(trim(rationale)) between 1 and 4000),created_at timestamptz not null default now(),
 unique(organization_id,case_id,user_id),foreign key(organization_id,case_id) references public.calibration_cases(organization_id,id),foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id)
);
alter table public.calibration_cases enable row level security;
alter table public.calibration_attempts enable row level security;
revoke all on public.calibration_cases,public.calibration_attempts from public,anon,authenticated,service_role;
-- Explicit RPC projections keep reference scores hidden until an evaluator submits.
create function public.calibration_workspace(p_organization_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare manager boolean;begin
 if not public.is_active_organization_member(p_organization_id) then raise exception 'membership required' using errcode='42501'; end if;
 manager:=public.is_active_organization_member(p_organization_id,array['owner','administrator']);
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'prompt',c.prompt,'rubric_guidance',c.rubric_guidance,
 'anchor_score',case when manager or exists(select 1 from public.calibration_attempts a where a.case_id=c.id and a.user_id=auth.uid()) then c.anchor_score else null end,
 'anchor_explanation',case when manager or exists(select 1 from public.calibration_attempts a where a.case_id=c.id and a.user_id=auth.uid()) then c.anchor_explanation else null end,
 'attempts',(select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'score',a.score,'rationale',a.rationale,'created_at',a.created_at)),'[]') from public.calibration_attempts a where a.case_id=c.id and (manager or a.user_id=auth.uid()))
 )),'[]') from public.calibration_cases c where c.organization_id=p_organization_id and c.active);
end;$$;
create function public.create_calibration_case(p_organization_id uuid,p_id uuid,p_title text,p_prompt text,p_guidance text,p_anchor integer,p_explanation text) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 insert into public.calibration_cases(id,organization_id,title,prompt,rubric_guidance,anchor_score,anchor_explanation) values(p_id,p_organization_id,p_title,p_prompt,p_guidance,p_anchor,p_explanation);
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(p_organization_id,auth.uid(),'calibration.created','calibration_case',p_id);return p_id;
end;$$;
create function public.submit_calibration(p_organization_id uuid,p_case_id uuid,p_score integer,p_rationale text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 if not public.is_active_organization_member(p_organization_id) or not exists(select 1 from public.calibration_cases where organization_id=p_organization_id and id=p_case_id and active) then raise exception 'active calibration required' using errcode='42501'; end if;
 insert into public.calibration_attempts(organization_id,case_id,user_id,score,rationale) values(p_organization_id,p_case_id,auth.uid(),p_score,p_rationale) returning id into result;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id) values(p_organization_id,auth.uid(),'calibration.submitted','calibration_attempt',result);return result;
end;$$;
revoke all on function public.calibration_workspace(uuid),public.create_calibration_case(uuid,uuid,text,text,text,integer,text),public.submit_calibration(uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function public.calibration_workspace(uuid),public.create_calibration_case(uuid,uuid,text,text,text,integer,text),public.submit_calibration(uuid,uuid,integer,text) to authenticated;
-- Close default service-role privileges on this module; imports and jobs must use scoped contracts.
do $$declare t text;begin
 foreach t in array array['scouting_grants','athlete_sport_profiles','evaluator_sport_profiles','performance_metrics','performance_results','scouting_records','tryout_stations','roster_scenarios','roster_scenario_members','participant_links','athlete_corrections','event_notices','event_fees'] loop
 execute format('revoke all on public.%I from service_role',t);
 end loop;
end;$$;
revoke all on function public.can_use_talent(uuid),public.talent_record_guard(),public.talent_record_audit(),public.performance_result_guard(),public.performance_metric_guard(),public.save_prospect_identity(uuid,uuid,text,text,date,timestamptz),public.scouting_approval_guard(),public.station_schedule_guard(),public.scenario_approval_guard(),public.import_performance_results(uuid,jsonb),public.can_view_participant(uuid,uuid),public.participant_workspace(),public.link_participant(uuid,uuid,text,text),public.participant_operation_guard() from service_role;
