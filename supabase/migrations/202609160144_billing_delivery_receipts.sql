-- Mutable operational delivery state is separate from immutable financial event history.
create table public.billing_deliveries (
 provider text not null check(provider in ('stripe','revenuecat')),provider_event_id text not null,
 event_type text not null,payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
 processing_status text not null check(processing_status in ('processing','processed','failed')),
 processing_error text,attempts integer not null default 1,last_received_at timestamptz not null default clock_timestamp(),processed_at timestamptz,
 primary key(provider,provider_event_id)
);
alter table public.billing_deliveries enable row level security;
revoke all on public.billing_deliveries from public,anon,authenticated,service_role;
create function public.record_billing_delivery(p_provider text,p_id text,p_type text,p_digest text,p_success boolean default null) returns text
language plpgsql security definer set search_path='' as $$
declare previous public.billing_deliveries%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('billing-delivery:'||p_provider||':'||p_id,0));
 select * into previous from public.billing_deliveries where provider=p_provider and provider_event_id=p_id for update;
 if found and previous.payload_digest<>p_digest then return 'conflict'; end if;
 if p_success is null then
  if previous.processing_status='processed' then return 'processed'; end if;
  if previous.processing_status='processing' and previous.last_received_at>now()-interval '1 minute' then return 'in_progress'; end if;
  insert into public.billing_deliveries(provider,provider_event_id,event_type,payload_digest,processing_status)
  values(p_provider,p_id,p_type,p_digest,'processing') on conflict(provider,provider_event_id) do update
  set attempts=public.billing_deliveries.attempts+1,last_received_at=clock_timestamp(),processing_status='processing',processing_error=null;
  return 'process';
 end if;
 if previous.provider is null then raise exception 'delivery_not_reserved'; end if;
 update public.billing_deliveries set processing_status=case when p_success then 'processed' else 'failed' end,
 processing_error=case when p_success then null else 'provider_reconciliation_failed' end,
 processed_at=case when p_success then clock_timestamp() else null end where provider=p_provider and provider_event_id=p_id;
 return case when p_success then 'processed' else 'failed' end;
end $$;
revoke all on function public.record_billing_delivery(text,text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.record_billing_delivery(text,text,text,text,boolean) to service_role;
