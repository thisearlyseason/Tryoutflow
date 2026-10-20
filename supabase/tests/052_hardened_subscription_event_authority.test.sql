begin;
select plan(22);

select has_column('public','subscription_accounts','provider_price_id','account stores verified price');
select has_column('public','subscription_accounts','current_period_start','account stores period start');
select has_column('public','subscription_accounts','current_period_end','account stores period end');
select has_column('public','subscription_accounts','cancel_at_period_end','account stores scheduled cancellation flag');
select has_column('public','subscription_accounts','cancel_at','account stores cancellation schedule');
select has_column('public','subscription_accounts','canceled_at','account stores cancellation observation');
select has_column('public','subscription_accounts','trial_end','account stores verified trial end');
select has_column('public','subscription_events','event_precedence','event snapshot stores formal precedence');

select ok(private.is_canonical_stripe_event_id('evt_12345678Ab'),'canonical event ID accepted');
select ok(not private.is_canonical_stripe_event_id('evt_1234_678Ab'),'event suffix underscore rejected');
select ok(private.is_canonical_stripe_customer_id('cus_12345678Ab'),'canonical customer ID accepted');
select ok(not private.is_canonical_stripe_customer_id('sub_12345678Ab'),'wrong customer kind rejected');
select ok(private.is_canonical_stripe_subscription_id('sub_12345678Ab'),'canonical subscription ID accepted');
select ok(private.is_canonical_stripe_price_id('price_12345678Ab'),'canonical price ID accepted');
select ok(not has_function_privilege('authenticated',
  'public.apply_stripe_subscription_event(text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,jsonb,text)',
  'execute'),'authenticated cannot invoke hardened event RPC');
select ok(has_function_privilege('service_role',
  'public.apply_stripe_subscription_event(text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,jsonb,text)',
  'execute'),'service role invokes only hardened event RPC');
select hasnt_function('public','apply_stripe_subscription_event',
  array['text','text','timestamp with time zone','text','text','uuid','text','text','jsonb','text'],
  'legacy event RPC is removed rather than remaining an attractive noncanonical overload');
select throws_ok($$select public.apply_stripe_subscription_event(
  'evt_Bad_Suffix01','customer.subscription.updated','2026-08-30T12:00:00Z',
  'cus_Permutation01','sub_Permutation01','price_TeamTask2401',null,'team','active',
  '2026-08-01','2026-09-01',false,null,null,null,'{}',repeat('a',64))$$,
  '22023','invalid stripe event','RPC rejects noncanonical IDs');
select throws_ok($$select public.apply_stripe_subscription_event(
  'evt_BadPeriod001','customer.subscription.updated','2026-08-30T12:00:00Z',
  'cus_Permutation01','sub_Permutation01','price_TeamTask2401',null,'team','active',
  '2026-09-01','2026-08-01',false,null,null,null,'{}',repeat('a',64))$$,
  '22023','invalid stripe event','RPC rejects contradictory verified periods');

insert into public.organizations(id,name,slug)
values('52000000-0000-4000-8000-000000000010','Task24 ordering','task24-ordering');

create function pg_temp.verify_all_subscription_event_permutations() returns boolean
language plpgsql set search_path='' as $$
declare a integer; b integer; c integer; d integer; e integer; f integer; candidate integer;
  permutation integer:=0; event_id text; outcome text;
  candidates integer[]; candidate_plan text; candidate_state text;
  candidate_cancel boolean; candidate_canceled_at timestamptz;
begin
  for a in 1..6 loop for b in 1..6 loop for c in 1..6 loop for d in 1..6 loop for e in 1..6 loop for f in 1..6 loop
    if (select pg_catalog.count(distinct value) from pg_catalog.unnest(array[a,b,c,d,e,f]) item(value))<>6
      then continue; end if;
    permutation:=permutation+1;
    update public.subscription_accounts set
      provider_customer_id=null,provider_subscription_id=null,provider_price_id=null,
      plan_key='trial',state='trialing',entitlement_source='system_trial',
      current_period_start=null,current_period_end=null,cancel_at_period_end=null,
      cancel_at=null,canceled_at=null,trial_end=null,last_provider_event_id=null,
      last_provider_event_created_at=null,last_provider_event_precedence=null
    where organization_id='52000000-0000-4000-8000-000000000010';
    candidates:=array[a,b,c,d,e,f];
    foreach candidate in array candidates loop
      candidate_plan:=case when candidate=5 then null else 'team' end;
      candidate_state:=case candidate when 1 then 'active' when 2 then 'active'
        when 3 then 'past_due' when 4 then 'canceled' when 5 then 'active' else 'paused' end;
      candidate_cancel:=candidate=2;
      candidate_canceled_at:=case when candidate=4 then '2026-08-30T12:00:00Z'::timestamptz else null end;
      event_id:='evt_Perm'||pg_catalog.lpad(permutation::text,3,'0')||candidate::text;
      outcome:=public.apply_stripe_subscription_event(
        event_id,'customer.subscription.updated','2026-08-30T12:00:00Z',
        'cus_Permutation01','sub_Permutation01','price_TeamTask2401',
        '52000000-0000-4000-8000-000000000010',candidate_plan,candidate_state,
        '2026-08-01T00:00:00Z','2026-09-01T00:00:00Z',candidate_cancel,null,
        candidate_canceled_at,null,'{}',pg_catalog.repeat(candidate::text,64)
      );
    end loop;
    if not exists(select 1 from public.subscription_accounts
      where organization_id='52000000-0000-4000-8000-000000000010'
        and plan_key is null and state='canceled' and last_provider_event_precedence=500)
      then return false; end if;
  end loop; end loop; end loop; end loop; end loop; end loop;
  return permutation=720;
end $$;

select ok(pg_temp.verify_all_subscription_event_permutations(),
  'all 720 same-timestamp arrival permutations converge across verified, unknown-price, and invalid-state ranks');

update public.subscription_accounts set
  plan_key='trial',state='trialing',entitlement_source='system_trial',
  current_period_start=null,current_period_end=null,cancel_at_period_end=null,
  cancel_at=null,canceled_at=null,trial_end=null,last_provider_event_id=null,
  last_provider_event_created_at=null,last_provider_event_precedence=null
where organization_id='52000000-0000-4000-8000-000000000010';
select public.apply_stripe_subscription_event(
  'evt_TieBreakHigh2','customer.subscription.updated','2026-08-30T13:00:00Z',
  'cus_Permutation01','sub_Permutation01','price_TeamTask2401',
  '52000000-0000-4000-8000-000000000010','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,'{}',repeat('a',64)
);
select public.apply_stripe_subscription_event(
  'evt_TieBreakLow01','customer.subscription.updated','2026-08-30T13:00:00Z',
  'cus_Permutation01','sub_Permutation01','price_TeamTask2401',
  '52000000-0000-4000-8000-000000000010','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,'{}',repeat('b',64)
);
select is((select last_provider_event_id from public.subscription_accounts
  where organization_id='52000000-0000-4000-8000-000000000010'),
  'evt_TieBreakLow01','C-collated event ID deterministically breaks otherwise equal ties');

select public.apply_stripe_subscription_event(
  'evt_LaterAuthority1','customer.subscription.updated','2026-08-30T13:00:01Z',
  'cus_Permutation01','sub_Permutation01','price_TeamTask2401',
  '52000000-0000-4000-8000-000000000010','team','trialing',
  '2026-08-01','2026-09-01',false,null,null,null,'{}',repeat('c',64)
);
select is((select state from public.subscription_accounts
  where organization_id='52000000-0000-4000-8000-000000000010'),
  'trialing','a later provider-created timestamp remains authoritative regardless of rank');

select * from finish();
rollback;
