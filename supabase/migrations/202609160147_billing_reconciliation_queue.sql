create table private.billing_reconciliation_queue (
 organization_id uuid primary key references public.organizations(id),next_attempt_at timestamptz not null default now(),last_error text
);
alter table private.billing_reconciliation_queue enable row level security;
revoke all on private.billing_reconciliation_queue from public,anon,authenticated,service_role;
create function private.queue_billing_reconciliation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.billing_reconciliation_queue(organization_id,next_attempt_at) values(new.organization_id,now()+interval '2 minutes')
 on conflict(organization_id) do update set next_attempt_at=least(private.billing_reconciliation_queue.next_attempt_at,excluded.next_attempt_at);
 return new;
end $$;
create trigger billing_contract_reconcile after insert on public.billing_contracts for each row execute function private.queue_billing_reconciliation();
create trigger billing_intent_reconcile after insert on private.billing_purchase_intents for each row execute function private.queue_billing_reconciliation();
insert into private.billing_reconciliation_queue(organization_id) select distinct organization_id from public.billing_contracts on conflict do nothing;
create function public.claim_billing_reconciliation() returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select organization_id into target from private.billing_reconciliation_queue where next_attempt_at<=now() order by next_attempt_at for update skip locked limit 1;
 if target is not null then update private.billing_reconciliation_queue set next_attempt_at=now()+interval '6 hours',last_error=null where organization_id=target; end if;
 return target;
end $$;
create function public.finish_billing_reconciliation(p_organization_id uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not p_success then update private.billing_reconciliation_queue set next_attempt_at=now()+interval '10 minutes',last_error='provider_unavailable' where organization_id=p_organization_id; end if;
end $$;
revoke all on function private.queue_billing_reconciliation(),public.claim_billing_reconciliation(),public.finish_billing_reconciliation(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.claim_billing_reconciliation(),public.finish_billing_reconciliation(uuid,boolean) to service_role;
do $$ declare source text; begin
 select pg_get_functiondef('public.apply_billing_snapshot(jsonb,jsonb,uuid)'::regprocedure) into source;
 source:=replace(source,'p_event->>''type''<>''REFUND_REVERSED''','p_event->>''type'' not in (''REFUND_REVERSED'',''subscription_revocation_reversed'')');
 execute source;
end $$;
