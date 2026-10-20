create table public.event_eligibility_policies(id uuid primary key default gen_random_uuid(),organization_id uuid not null,tryout_id uuid not null,cutoff_date date not null,rules text not null default '' check(length(rules)<=8000),version integer not null default 1,created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,tryout_id),foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id));
create table public.eligibility_exceptions(id uuid primary key default gen_random_uuid(),organization_id uuid not null,tryout_id uuid not null,athlete_id uuid not null,policy_version integer not null,status text not null check(status in ('pending','approved','declined')),reason text not null check(length(trim(reason)) between 1 and 4000),version integer not null default 1,created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,tryout_id,athlete_id),foreign key(organization_id,tryout_id) references public.event_eligibility_policies(organization_id,tryout_id),foreign key(organization_id,athlete_id) references public.athletes(organization_id,id));
alter table public.event_eligibility_policies enable row level security;alter table public.eligibility_exceptions enable row level security;
create policy eligibility_policy_managers on public.event_eligibility_policies for select to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator']));
create policy eligibility_exceptions_managers on public.eligibility_exceptions for select to authenticated using(public.is_active_organization_member(organization_id,array['owner','administrator']));
revoke all on public.event_eligibility_policies,public.eligibility_exceptions from public,anon,authenticated,service_role;
grant select on public.event_eligibility_policies,public.eligibility_exceptions to authenticated;
create trigger talent_guard before insert or update on public.event_eligibility_policies for each row execute function public.talent_record_guard();
create trigger talent_audit after insert or update on public.event_eligibility_policies for each row execute function public.talent_record_audit();
create trigger talent_guard before insert or update on public.eligibility_exceptions for each row execute function public.talent_record_guard();
create trigger talent_audit after insert or update on public.eligibility_exceptions for each row execute function public.talent_record_audit();
create function public.save_eligibility_policy(p_organization_id uuid,p_tryout_id uuid,p_cutoff_date date,p_rules text,p_version integer) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tryout_id::text,135));
 if p_version=0 then insert into public.event_eligibility_policies(organization_id,tryout_id,cutoff_date,rules) values(p_organization_id,p_tryout_id,p_cutoff_date,p_rules);
 else update public.event_eligibility_policies set cutoff_date=p_cutoff_date,rules=p_rules,version=version+1 where organization_id=p_organization_id and tryout_id=p_tryout_id and version=p_version; if not found then raise exception 'refresh before saving policy' using errcode='40001';end if;end if;return true;
end;$$;
create function public.save_eligibility_exception(p_organization_id uuid,p_tryout_id uuid,p_athlete_id uuid,p_policy_version integer,p_status text,p_reason text,p_version integer) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tryout_id::text,135));
 if not exists(select 1 from public.event_eligibility_policies where organization_id=p_organization_id and tryout_id=p_tryout_id and version=p_policy_version) then raise exception 'eligibility policy changed; review it first' using errcode='40001';end if;
 if p_version=0 then insert into public.eligibility_exceptions(organization_id,tryout_id,athlete_id,policy_version,status,reason) values(p_organization_id,p_tryout_id,p_athlete_id,p_policy_version,p_status,p_reason);
 else update public.eligibility_exceptions set policy_version=p_policy_version,status=p_status,reason=p_reason,version=version+1 where organization_id=p_organization_id and tryout_id=p_tryout_id and athlete_id=p_athlete_id and version=p_version;if not found then raise exception 'refresh before saving review' using errcode='40001';end if;end if;return true;
end;$$;
revoke all on function public.save_eligibility_policy(uuid,uuid,date,text,integer),public.save_eligibility_exception(uuid,uuid,uuid,integer,text,text,integer) from public,anon,service_role;
grant execute on function public.save_eligibility_policy(uuid,uuid,date,text,integer),public.save_eligibility_exception(uuid,uuid,uuid,integer,text,text,integer) to authenticated;
