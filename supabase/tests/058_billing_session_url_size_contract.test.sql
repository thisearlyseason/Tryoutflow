begin;
select plan(13);

select ok(private.is_valid_billing_session_url(
  'cs_test_'||repeat('A',200),
  'https://checkout.stripe.com/c/pay/cs_test_'||repeat('A',200),
  'checkout'
),'checkout object ID accepts suffix at cap');
select ok(not private.is_valid_billing_session_url(
  'cs_test_'||repeat('A',201),
  'https://checkout.stripe.com/c/pay/cs_test_'||repeat('A',201),
  'checkout'
),'checkout object ID rejects suffix over cap');
select ok(private.is_valid_billing_session_url(
  'cs_live_A','https://checkout.stripe.com/c/pay/cs_live_A','checkout'
),'checkout object ID accepts one-character suffix');
select ok(not private.is_valid_billing_session_url(
  'cs_live_','https://checkout.stripe.com/c/pay/cs_live_','checkout'
),'checkout object ID rejects empty suffix');

select ok(private.is_valid_billing_session_url(
  'bps_'||repeat('A',200),'https://billing.stripe.com/p/session/test_A','portal'
),'portal object ID accepts suffix at cap');
select ok(not private.is_valid_billing_session_url(
  'bps_'||repeat('A',201),'https://billing.stripe.com/p/session/test_A','portal'
),'portal object ID rejects suffix over cap');
select ok(private.is_valid_billing_session_url(
  'bps_A','https://billing.stripe.com/p/session/live_A','portal'
),'portal object ID accepts one-character suffix');
select ok(not private.is_valid_billing_session_url(
  'bps_','https://billing.stripe.com/p/session/live_A','portal'
),'portal object ID rejects empty suffix');

select ok(private.is_valid_billing_session_url(
  'bps_A','https://billing.stripe.com/p/session/test_'||repeat('A',2048),'portal'
),'portal bearer accepts suffix at cap');
select ok(not private.is_valid_billing_session_url(
  'bps_A','https://billing.stripe.com/p/session/test_'||repeat('A',2049),'portal'
),'portal bearer rejects suffix over cap');
select ok(not private.is_valid_billing_session_url(
  'bps_A','https://billing.stripe.com/p/session/test_'||repeat('A',4055),'portal'
),'portal rejects a total URL over 4096 characters');
select ok(private.is_valid_billing_session_url(
  'cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#'||repeat('%41',682)||'AA','checkout'
),'checkout fragment cap counts 2048 raw percent-escape characters');
select ok(not private.is_valid_billing_session_url(
  'cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#'||repeat('%41',2048),'checkout'
),'checkout fragment cap counts raw percent escapes, not decoded bytes');

select * from finish();
rollback;
