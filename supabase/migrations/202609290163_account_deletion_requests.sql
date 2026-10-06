-- Durable manual-fulfillment requests. No organization or account is deleted by submission.
begin;
create table private.account_deletion_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references auth.users(id) on delete set null,
 requested_at timestamptz not null default now(),
 due_at timestamptz not null default (now() + interval '7 days'),
 status text not null default 'requested' check (status in ('requested','processing','completed')),
 contact_email text,
 notification_provider_id text,
 organization_snapshot jsonb not null,
 policy_version text not null default '2026-09-29-seven-days',
 completed_at timestamptz,
 constraint deletion_completion check ((status='completed') = (completed_at is not null))
);
alter table private.account_deletion_requests enable row level security;
revoke all on private.account_deletion_requests from public,anon,authenticated,service_role;

create function public.request_account_deletion(p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare requester uuid := auth.uid(); email_address text; result private.account_deletion_requests; organizations jsonb;
begin
 if requester is null then raise exception 'unauthorized' using errcode='42501'; end if;
 if p_confirm is distinct from true then raise exception 'confirmation_required' using errcode='22023'; end if;
 select email into email_address from auth.users where id=requester and email_confirmed_at is not null;
 if email_address is null then raise exception 'verified_email_required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'role',m.role)), '[]'::jsonb)
 into organizations from public.organization_members m join public.organizations o on o.id=m.organization_id
 where m.user_id=requester and m.status='active';
 insert into private.account_deletion_requests(user_id,contact_email,organization_snapshot)
 values(requester,email_address,organizations) on conflict(user_id) do nothing;
 select * into result from private.account_deletion_requests where user_id=requester;
 return jsonb_build_object('id',result.id,'requestedAt',result.requested_at,'dueAt',result.due_at,'status',result.status);
end $$;

create function public.get_account_deletion_request() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result private.account_deletion_requests;
begin
 if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
 select * into result from private.account_deletion_requests where user_id=auth.uid();
 if not found then return null; end if;
 return jsonb_build_object('id',result.id,'requestedAt',result.requested_at,'dueAt',result.due_at,'status',result.status);
end $$;

create function public.platform_account_deletion_requests() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_platform_administrator() then raise exception 'forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.due_at) from private.account_deletion_requests r where r.status<>'completed'),'[]'::jsonb);
end $$;
revoke all on function public.request_account_deletion(boolean),public.get_account_deletion_request(),public.platform_account_deletion_requests() from public,anon,authenticated,service_role;
grant execute on function public.request_account_deletion(boolean),public.get_account_deletion_request(),public.platform_account_deletion_requests() to authenticated;
create function public.pending_account_deletion_notices() returns jsonb
language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from
 (select id, requested_at, due_at from private.account_deletion_requests
 where notification_provider_id is null and status<>'completed' order by due_at limit 20) r;
$$;
create function public.record_account_deletion_notice(p_id uuid,p_provider_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_provider_id is null or length(p_provider_id)>100 then raise exception 'invalid_provider_id'; end if;
 update private.account_deletion_requests set notification_provider_id=p_provider_id where id=p_id and notification_provider_id is null;
end $$;
revoke all on function public.pending_account_deletion_notices(), public.record_account_deletion_notice(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.pending_account_deletion_notices(), public.record_account_deletion_notice(uuid,text) to service_role;
create function public.platform_update_account_deletion(p_id uuid,p_complete boolean default false,p_confirmed boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare target private.account_deletion_requests;
begin
 if not public.is_active_platform_administrator() then raise exception 'forbidden' using errcode='42501'; end if;
 select * into target from private.account_deletion_requests where id=p_id for update;
 if not found then raise exception 'request_not_found' using errcode='22023'; end if;
 if target.status='completed' then return; end if;
 if p_complete then
  if target.user_id is not null or p_confirmed is distinct from true then
   raise exception 'verify_account_removal_and_completion_notice_first' using errcode='22023';
  end if;
  update private.account_deletion_requests set status='completed',completed_at=now(),contact_email=null,organization_snapshot='[]'::jsonb,notification_provider_id=null where id=p_id;
 else
  update private.account_deletion_requests set status='processing' where id=p_id;
 end if;
end $$;
revoke all on function public.platform_update_account_deletion(uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.platform_update_account_deletion(uuid,boolean,boolean) to authenticated;
commit;
