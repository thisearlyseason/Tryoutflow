create table public.participant_links (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,athlete_id uuid not null,user_id uuid not null references auth.users(id),
 relationship text not null check(relationship in ('athlete','guardian')),active boolean not null default true,
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 unique(organization_id,athlete_id,user_id),foreign key(organization_id,athlete_id) references public.athletes(organization_id,id)
);
create function public.can_view_participant(p_organization_id uuid,p_athlete_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.participant_links where organization_id=p_organization_id and athlete_id=p_athlete_id and user_id=auth.uid() and active);
$$;
create table public.athlete_corrections (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,athlete_id uuid not null,request_text text not null check(length(trim(request_text)) between 1 and 4000),
 response text not null default '' check(length(response)<=4000),status text not null default 'pending' check(status in ('pending','resolved','declined')),
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 foreign key(organization_id,athlete_id) references public.athletes(organization_id,id)
);
create table public.event_notices (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,tryout_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 160),body text not null check(length(trim(body)) between 1 and 8000),
 category text not null check(category in ('schedule','arrival','equipment','reminder','update')),
 status text not null default 'draft' check(status in ('draft','published','archived')),
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id)
);
-- Fees are an auditable offline ledger. Provider receipts must never be inferred from these entries.
create table public.event_fees (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,tryout_id uuid not null,athlete_id uuid not null,
 description text not null check(length(trim(description)) between 1 and 160),currency text not null check(currency ~ '^[A-Z]{3}$'),
 amount_cents integer not null check(amount_cents between 0 and 10000000),paid_cents integer not null default 0 check(paid_cents>=0),refunded_cents integer not null default 0 check(refunded_cents>=0),waived_cents integer not null default 0 check(waived_cents>=0),
 due_on date,reference text not null default '' check(length(reference)<=300),note text not null default '' check(length(note)<=2000),
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),version integer not null default 1,
 check(refunded_cents<=paid_cents and waived_cents<=amount_cents and paid_cents-refunded_cents+waived_cents<=amount_cents),
 foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id),foreign key(organization_id,athlete_id) references public.athletes(organization_id,id)
);
create function public.participant_operation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='athlete_corrections' and not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then
  if tg_op<>'INSERT' or new.status<>'pending' or new.response<>'' or not public.can_view_participant(new.organization_id,new.athlete_id) then raise exception 'invalid participant correction' using errcode='42501'; end if;
 elsif not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 if tg_table_name='event_fees' then
  if (new.paid_cents>0 or new.refunded_cents>0 or new.waived_cents>0) and length(trim(new.reference))=0 then raise exception 'record receipt or approval reference' using errcode='23514'; end if;
 end if;
 return new;
end;$$;
do $$declare t text;begin
 foreach t in array array['participant_links','athlete_corrections','event_notices','event_fees'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update on public.%I to authenticated',t);
 execute format('create policy organizer_manage on public.%I for all to authenticated using(public.is_active_organization_member(organization_id,array[''owner'',''administrator''])) with check(public.is_active_organization_member(organization_id,array[''owner'',''administrator'']))',t);
 execute format('create trigger operation_guard before insert or update on public.%I for each row execute function public.participant_operation_guard()',t);
 execute format('create trigger talent_version before insert or update on public.%I for each row execute function public.talent_record_guard()',t);
 execute format('create trigger talent_audit after insert or update on public.%I for each row execute function public.talent_record_audit()',t);
 end loop;
end;$$;
create policy participant_link_self on public.participant_links for select to authenticated using(user_id=auth.uid() and active);
create policy participant_correction_read on public.athlete_corrections for select to authenticated using(public.can_view_participant(organization_id,athlete_id));
create policy participant_correction_create on public.athlete_corrections for insert to authenticated with check(public.can_view_participant(organization_id,athlete_id) and created_by=auth.uid());
-- No new broad SELECT policy on athletes or scouting_records: participant reads use an allowlisted RPC.
create function public.participant_workspace() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'organization_id',l.organization_id,'athlete_id',l.athlete_id,'organization',o.name,'name',a.given_name||' '||a.family_name,'birth_date',a.birth_date,
 'profile',(select jsonb_build_object('preferred_name',p.preferred_name,'sport',p.sport,'primary_position',p.primary_position,'current_team',p.current_team,'competitive_level',p.competitive_level) from public.athlete_sport_profiles p where p.organization_id=l.organization_id and p.athlete_id=l.athlete_id),
 'feedback',(select coalesce(jsonb_agg(jsonb_build_object('title',r.title,'body',r.body,'strengths',r.strengths,'development_areas',r.development_areas,'recommendation',r.recommendation,'kind',r.kind,'due_on',r.due_on,'video_url',r.video_url,'start_seconds',r.start_seconds)),'[]') from public.scouting_records r where r.organization_id=l.organization_id and r.athlete_id=l.athlete_id and r.visibility='athlete' and r.status='approved'),
 'registrations',(select coalesce(jsonb_agg(jsonb_build_object('tryout',t.name,'tryout_id',t.id,'status',r.status)),'[]') from public.tryout_registrations r join public.tryouts t on t.organization_id=r.organization_id and t.id=r.tryout_id where r.organization_id=l.organization_id and r.athlete_id=l.athlete_id),
 'notices',(select coalesce(jsonb_agg(jsonb_build_object('title',n.title,'body',n.body,'category',n.category,'updated_at',n.updated_at)),'[]') from public.event_notices n where n.organization_id=l.organization_id and n.status='published' and exists(select 1 from public.tryout_registrations r where r.organization_id=l.organization_id and r.athlete_id=l.athlete_id and r.tryout_id=n.tryout_id)),
 'fees',(select coalesce(jsonb_agg(jsonb_build_object('description',f.description,'currency',f.currency,'amount_cents',f.amount_cents,'paid_cents',f.paid_cents,'refunded_cents',f.refunded_cents,'waived_cents',f.waived_cents,'due_on',f.due_on)),'[]') from public.event_fees f where f.organization_id=l.organization_id and f.athlete_id=l.athlete_id),
 'corrections',(select coalesce(jsonb_agg(jsonb_build_object('request_text',r.request_text,'status',r.status,'response',r.response)),'[]') from public.athlete_corrections r where r.organization_id=l.organization_id and r.athlete_id=l.athlete_id)
 )),'[]') from public.participant_links l join public.athletes a on a.organization_id=l.organization_id and a.id=l.athlete_id join public.organizations o on o.id=l.organization_id where l.user_id=auth.uid() and l.active;
$$;
create function public.link_participant(p_organization_id uuid,p_athlete_id uuid,p_email text,p_relationship text) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;answer uuid;begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 select id into target from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if target is null then raise exception 'participant must first verify their account email' using errcode='23514'; end if;
 insert into public.participant_links(organization_id,athlete_id,user_id,relationship) values(p_organization_id,p_athlete_id,target,p_relationship) returning id into answer;return answer;
end;$$;
revoke all on function public.can_view_participant(uuid,uuid),public.participant_workspace(),public.link_participant(uuid,uuid,text,text) from public,anon;
grant execute on function public.can_view_participant(uuid,uuid),public.participant_workspace(),public.link_participant(uuid,uuid,text,text) to authenticated;
revoke all on function public.participant_operation_guard() from public,anon,authenticated;
