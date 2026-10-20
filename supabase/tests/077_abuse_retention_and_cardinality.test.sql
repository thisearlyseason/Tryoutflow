begin;

set local search_path=extensions,public;
select plan(20);

select function_privs_are(
  'public','consume_abuse_rate_limit',array['text','text','text','integer','integer'],
  'service_role',array['EXECUTE'],'only the service route may consume a shared limiter'
);
select function_privs_are(
  'public','consume_bot_token_once',array['text','text','integer'],
  'service_role',array['EXECUTE'],'only the service route may consume verified bot evidence'
);
select is(
  (select proconfig from pg_proc where oid='public.consume_abuse_rate_limit(text,text,text,integer,integer)'::regprocedure),
  array['search_path=""']::text[],'the limiter replacement keeps an empty search path'
);
select is(
  (select proconfig from pg_proc where oid='public.consume_bot_token_once(text,text,integer)'::regprocedure),
  array['search_path=""']::text[],'the bot receipt replacement keeps an empty search path'
);
select ok(
  lower(pg_get_functiondef('public.consume_abuse_rate_limit(text,text,text,integer,integer)'::regprocedure))
    like '%pg_try_advisory_xact_lock%' and
  lower(pg_get_functiondef('public.consume_abuse_rate_limit(text,text,text,integer,integer)'::regprocedure))
    like '%limit 100%',
  'limiter expiry purge is guarded by a non-blocking transaction lock and a fixed batch bound'
);
select ok(
  lower(pg_get_functiondef('public.consume_bot_token_once(text,text,integer)'::regprocedure))
    like '%pg_try_advisory_xact_lock%' and
  lower(pg_get_functiondef('public.consume_bot_token_once(text,text,integer)'::regprocedure))
    like '%limit 100%',
  'bot receipt expiry purge is guarded by a non-blocking transaction lock and a fixed batch bound'
);

delete from private.abuse_rate_limits where expires_at<=clock_timestamp();
delete from private.bot_token_receipts where expires_at<=clock_timestamp();

insert into private.abuse_rate_limits(
  subject_digest,address_digest,scope,attempts,window_started_at,expires_at
)
select
  encode(extensions.digest('expired-rate-subject-'||item,'sha256'),'hex'),
  encode(extensions.digest('expired-rate-address-'||item,'sha256'),'hex'),
  'registration_reissue',1,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour'
from generate_series(1,150) item;

insert into private.bot_token_receipts(token_digest,action,consumed_at,expires_at)
select
  encode(extensions.digest('expired-bot-token-'||item,'sha256'),'hex'),
  'registration_reissue',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour'
from generate_series(1,150) item;

insert into private.abuse_rate_limits(
  subject_digest,address_digest,scope,attempts,window_started_at,expires_at
)
select
  encode(extensions.digest('live-rate-subject-'||item,'sha256'),'hex'),
  encode(extensions.digest('live-rate-address-'||item,'sha256'),'hex'),
  'registration_reissue',1,clock_timestamp(),clock_timestamp()+interval '1 hour'
from generate_series(1,2) item;

insert into private.bot_token_receipts(token_digest,action,expires_at)
select
  encode(extensions.digest('live-bot-token-'||item,'sha256'),'hex'),
  'registration_reissue',clock_timestamp()+interval '1 hour'
from generate_series(1,2) item;

set local role service_role;
select is(
  (select allowed from public.consume_abuse_rate_limit(repeat('e',64),repeat('f',64),'registration_reissue',4,60)),
  true,'a fixed reissue network/action key starts one atomic window'
);
select is(
  (select consumed from public.consume_bot_token_once(repeat('a',64),'registration_reissue',300)),
  true,'a fresh verified reissue token is consumed once'
);
reset role;

select is(
  (select count(*) from private.abuse_rate_limits where expires_at<=clock_timestamp()),
  50::bigint,'one limiter call purges at most one bounded batch of 100 expired rows'
);
select is(
  (select count(*) from private.bot_token_receipts where expires_at<=clock_timestamp()),
  50::bigint,'one bot receipt call purges at most one bounded batch of 100 expired rows'
);
select is(
  (select count(*) from private.abuse_rate_limits
    where subject_digest in(
      select encode(extensions.digest('live-rate-subject-'||item,'sha256'),'hex')
      from generate_series(1,2) item
    )),
  2::bigint,'bounded limiter cleanup preserves every live unrelated row'
);
select is(
  (select count(*) from private.bot_token_receipts
    where token_digest in(
      select encode(extensions.digest('live-bot-token-'||item,'sha256'),'hex')
      from generate_series(1,2) item
    )),
  2::bigint,'bounded bot cleanup preserves every live unrelated row'
);

set local role service_role;
select is(
  (select allowed from public.consume_abuse_rate_limit(repeat('e',64),repeat('f',64),'registration_reissue',4,60)),
  true,'the same fixed reissue key increments without adding cardinality'
);
select is(
  (select consumed from public.consume_bot_token_once(repeat('b',64),'registration_reissue',300)),
  true,'a later verified token drives the next bounded cleanup batch'
);
reset role;

select is(
  (select count(*) from private.abuse_rate_limits where expires_at<=clock_timestamp()),
  0::bigint,'repeated bounded limiter work eventually removes all expired rows'
);
select is(
  (select count(*) from private.bot_token_receipts where expires_at<=clock_timestamp()),
  0::bigint,'repeated bounded bot receipt work eventually removes all expired rows'
);
select is(
  (select count(*) from private.abuse_rate_limits where subject_digest=repeat('e',64) and address_digest=repeat('f',64) and scope='registration_reissue'),
  1::bigint,'rotated proof attempts retain exactly one fixed-cardinality limiter row'
);
select is(
  (select attempts from private.abuse_rate_limits where subject_digest=repeat('e',64) and address_digest=repeat('f',64) and scope='registration_reissue'),
  2,'the fixed row records both allowed attempts atomically'
);
select ok(
  (select expires_at>clock_timestamp()+interval '45 seconds'
    and expires_at<=clock_timestamp()+interval '61 seconds'
    from private.abuse_rate_limits
    where subject_digest=repeat('e',64) and address_digest=repeat('f',64)
      and scope='registration_reissue'),
  'the durable reissue counter retains the requested bounded TTL'
);
select ok(
  (select expires_at>clock_timestamp()+interval '285 seconds'
    and expires_at<=clock_timestamp()+interval '301 seconds'
    from private.bot_token_receipts
    where token_digest=repeat('b',64) and action='registration_reissue'),
  'the single-use bot receipt retains the requested bounded TTL'
);

select * from finish();
rollback;
