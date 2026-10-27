-- Family invitations grant one athlete link, never organization membership.
begin;
create table public.family_invitations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 athlete_id uuid not null,
 email text not null check(email=lower(trim(email)) and length(email) between 3 and 254),
 relationship text not null check(relationship in ('athlete','guardian')),
 token_digest text not null unique check(token_digest ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '7 days'),
 revoked_at timestamptz,
 accepted_at timestamptz,
 accepted_by uuid references auth.users(id),
 linked_id uuid references public.participant_links(id) deferrable initially deferred,
 foreign key(organization_id,athlete_id) references public.athletes(organization_id,id),
 check((accepted_at is null and accepted_by is null and linked_id is null) or
       (accepted_at is not null and accepted_by is not null and linked_id is not null))
);
create index family_invitations_organization on public.family_invitations(organization_id,created_at desc);
alter table public.family_invitations enable row level security;
revoke all on public.family_invitations from public,anon,authenticated,service_role;
grant select(id,organization_id,athlete_id,email,relationship,created_by,created_at,expires_at,revoked_at,accepted_at,accepted_by,linked_id)
 on public.family_invitations to authenticated;
create policy family_invitation_organizer_read on public.family_invitations for select to authenticated
 using(public.is_active_organization_member(organization_id,array['owner','administrator']));

create function public.create_family_invitation(p_organization_id uuid,p_athlete_id uuid,p_email text,p_relationship text,p_token_digest text)
returns uuid language plpgsql security definer set search_path='' as $$
declare answer uuid; normalized text:=lower(trim(p_email)); begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
  raise exception 'organizer required' using errcode='42501';
 end if;
 if normalized is null or length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_relationship is null or p_relationship not in ('athlete','guardian')
    or p_token_digest is null or p_token_digest !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from public.athletes where organization_id=p_organization_id and id=p_athlete_id) then
  raise exception 'invalid family invitation' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text||p_athlete_id::text||normalized,0));
 -- Reissuing replaces older pending links, including a lost-response retry.
 update public.family_invitations set revoked_at=clock_timestamp()
  where organization_id=p_organization_id and athlete_id=p_athlete_id and email=normalized
    and accepted_at is null and revoked_at is null;
 insert into public.family_invitations(organization_id,athlete_id,email,relationship,token_digest,created_by)
 values(p_organization_id,p_athlete_id,normalized,p_relationship,p_token_digest,auth.uid()) returning id into answer;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
 values(p_organization_id,auth.uid(),'family_invitation.created','family_invitation',answer,jsonb_build_object('athlete_id',p_athlete_id));
 return answer;
end;$$;

create function public.revoke_family_invitation(p_organization_id uuid,p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then
  raise exception 'organizer required' using errcode='42501';
 end if;
 update public.family_invitations set revoked_at=coalesce(revoked_at,clock_timestamp())
 where organization_id=p_organization_id and id=p_invitation_id and accepted_at is null;
 if not found then return false; end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
 values(p_organization_id,auth.uid(),'family_invitation.revoked','family_invitation',p_invitation_id);
 return true;
end;$$;

-- Preserve existing correction/ledger rules. A claim can insert only the exact
-- link bound by the protected invitation row in this same transaction.
create or replace function public.participant_operation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='participant_links' and tg_op='INSERT' then
 if new.user_id=auth.uid() and new.created_by=auth.uid()
    and exists(select 1 from public.family_invitations i where i.linked_id=new.id
      and i.organization_id=new.organization_id and i.athlete_id=new.athlete_id
      and i.relationship=new.relationship and i.accepted_by=auth.uid()
      and i.accepted_at=transaction_timestamp() and i.revoked_at is null and i.expires_at>now()) then
  return new;
 end if;
 end if;
 if tg_table_name='athlete_corrections' and not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then
  if tg_op<>'INSERT' or new.status<>'pending' or new.response<>'' or not public.can_view_participant(new.organization_id,new.athlete_id) then raise exception 'invalid participant correction' using errcode='42501'; end if;
 elsif not public.is_active_organization_member(new.organization_id,array['owner','administrator']) then raise exception 'organizer required' using errcode='42501'; end if;
 if tg_table_name='event_fees' then
  if (new.paid_cents>0 or new.refunded_cents>0 or new.waived_cents>0) and length(trim(new.reference))=0 then raise exception 'record receipt or approval reference' using errcode='23514'; end if;
 end if;
 return new;
end;$$;

create function public.accept_family_invitation(p_token_digest text)
returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.family_invitations%rowtype; target_email text; link public.participant_links%rowtype; link_id uuid; begin
 if p_token_digest is null or p_token_digest !~ '^[a-f0-9]{64}$' then raise exception 'family invitation unavailable' using errcode='23514'; end if;
 select lower(email) into target_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into invitation from public.family_invitations where token_digest=p_token_digest for update;
 if target_email is null or invitation.id is null or invitation.email<>target_email
    or invitation.revoked_at is not null or invitation.expires_at<=now()
    or not exists(select 1 from public.organization_members where organization_id=invitation.organization_id
      and user_id=invitation.created_by and role in ('owner','administrator') and status='active') then
  raise exception 'family invitation unavailable' using errcode='23514';
 end if;
 if invitation.accepted_at is not null then
  if invitation.accepted_by=auth.uid() and exists(select 1 from public.participant_links where id=invitation.linked_id and user_id=auth.uid() and active) then return invitation.linked_id; end if;
  raise exception 'family invitation unavailable' using errcode='23514';
 end if;
 -- Serialize claims for different invitations to the same athlete/account.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(invitation.organization_id::text||invitation.athlete_id::text||auth.uid()::text,0));
 select * into link from public.participant_links where organization_id=invitation.organization_id and athlete_id=invitation.athlete_id and user_id=auth.uid() for update;
 if link.id is not null and not link.active then
  -- A pending invitation must never undo an organizer's revocation.
  raise exception 'family invitation unavailable' using errcode='23514';
 end if;
 link_id:=coalesce(link.id,gen_random_uuid());
 update public.family_invitations set accepted_at=transaction_timestamp(),accepted_by=auth.uid(),linked_id=link_id where id=invitation.id;
 if link.id is null then
  insert into public.participant_links(id,organization_id,athlete_id,user_id,relationship,created_by)
  values(link_id,invitation.organization_id,invitation.athlete_id,auth.uid(),invitation.relationship,auth.uid());
 end if;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
 values(invitation.organization_id,auth.uid(),'family_invitation.accepted','family_invitation',invitation.id,jsonb_build_object('athlete_id',invitation.athlete_id));
 return link_id;
end;$$;
revoke all on function public.create_family_invitation(uuid,uuid,text,text,text),public.revoke_family_invitation(uuid,uuid),public.accept_family_invitation(text) from public,anon,authenticated,service_role;
grant execute on function public.create_family_invitation(uuid,uuid,text,text,text),public.revoke_family_invitation(uuid,uuid),public.accept_family_invitation(text) to authenticated;
commit;
