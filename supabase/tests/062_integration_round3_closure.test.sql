begin;
select plan(9);

select has_type('public','integration_retry_v3_result','retry v3 exposes one authoritative durable projection');
select has_function('public','retry_integration_sync_job_v3',array['uuid','uuid','text']);
select is(
  (select proconfig from pg_proc where pronamespace='public'::regnamespace and proname='retry_integration_sync_job_v3'),
  array['search_path=""']::text[],
  'retry v3 uses an empty search path'
);
select ok(
  position('job.provider_submission_started_at is null' in pg_get_functiondef('public.claim_integration_outbox_jobs(text,integer,integer)'::regprocedure))>0,
  'ordinary claims categorically exclude prior provider handoff'
);
select ok(
  position('confirmation_token_digest' in pg_get_functiondef('public.confirm_roster_export_preview_v3(uuid,text,text,text)'::regprocedure))>0,
  'confirmation replay binds the exact confirmation token digest'
);
select ok(
  position('for outbox in select * from public.integration_outbox_jobs' in pg_get_functiondef('public.purge_expired_integration_previews(integer)'::regprocedure))
    < position('select * into sync from public.integration_sync_jobs' in pg_get_functiondef('public.purge_expired_integration_previews(integer)'::regprocedure)),
  'retention locks outbox rows before the sync row'
);
select has_trigger('public','integration_export_previews','cap_integration_preview_expiry','future preview expiry remains capped');
select ok(
  not exists(select 1 from public.integration_export_previews where expires_at>created_at+interval '7 days'),
  'all upgraded previews are capped at seven days'
);
select ok(
  not exists(select 1 from public.integration_export_previews
    where expires_at<=clock_timestamp() and (
      provider_confirmation_token is not null
      or roster_snapshot<>'{}'::jsonb
      or preview_snapshot is not null
    )),
  'expired upgraded previews retain no token, raw roster, or provider preview bytes'
);

select * from finish();
rollback;
