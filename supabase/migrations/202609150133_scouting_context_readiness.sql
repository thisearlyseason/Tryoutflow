-- Keep observation context and evaluator declarations explicit; neither changes scoring weights.
alter table public.scouting_records add column observation_type text not null default 'live' check(observation_type in ('live','video','training','other')),add column event_context text not null default '' check(length(event_context)<=500),add column criterion text not null default '' check(length(criterion)<=300),add column review_feedback text not null default '' check(length(review_feedback)<=4000);
alter table public.evaluator_sport_profiles add column affiliation text not null default '' check(length(affiliation)<=200),add column device_check_complete boolean not null default false,add column assignments_acknowledged boolean not null default false;
-- Review feedback is owned by organizers; scouts may request review through the existing status.
create function public.scouting_review_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not public.is_active_organization_member(new.organization_id,array['owner','administrator']) and ((tg_op='INSERT' and new.review_feedback<>'') or (tg_op='UPDATE' and new.review_feedback is distinct from old.review_feedback)) then raise exception 'organizer must record review feedback' using errcode='42501';end if;return new;
end;$$;
create trigger scouting_review_guard before insert or update on public.scouting_records for each row execute function public.scouting_review_guard();
revoke all on function public.scouting_review_guard() from public,anon,authenticated,service_role;
