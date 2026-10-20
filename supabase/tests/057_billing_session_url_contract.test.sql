begin;
select plan(24);

select ok(private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A','checkout'),'checkout accepts one-character suffix');
select ok(private.is_valid_billing_session_url('cs_live_Z','https://checkout.stripe.com/c/pay/cs_live_Z#abc%2Fdef%3Fghi-._~!$&''()*+,;=:@/?','checkout'),'checkout accepts RFC 3986 fragment characters and percent escapes');
select ok(private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#'||repeat('A',2048),'checkout'),'checkout accepts fragment at cap');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#'||repeat('A',2049),'checkout'),'checkout rejects fragment over cap');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#','checkout'),'checkout rejects empty fragment');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#bad%','checkout'),'checkout rejects lone percent');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#bad%2','checkout'),'checkout rejects short percent escape');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#bad%GG','checkout'),'checkout rejects nonhex percent escape');
select ok(private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A#x%0Ay','checkout'),'encoded control bytes remain opaque fragment data');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A'||chr(10),'checkout'),'checkout rejects literal controls');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_A?x=1','checkout'),'checkout rejects query');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay%2Fcs_test_A','checkout'),'encoded path delimiter cannot alter checkout path');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com@evil.example/c/pay/cs_test_A','checkout'),'checkout rejects credential host trick');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com:8443/c/pay/cs_test_A','checkout'),'checkout rejects nondefault port');
select ok(not private.is_valid_billing_session_url('cs_test_A','https://checkout.stripe.com/c/pay/cs_test_B','checkout'),'checkout requires path ID to equal object ID');

select ok(private.is_valid_billing_session_url('bps_A','https://billing.stripe.com/p/session/test_B','portal'),'portal accepts independent test bearer token');
select ok(private.is_valid_billing_session_url('bps_123','https://billing.stripe.com/p/session/live_Z9','portal'),'portal accepts independent live bearer token');
select ok(not private.is_valid_billing_session_url('bps_123','https://billing.stripe.com/p/session/bps_123','portal'),'portal does not confuse object ID with bearer token');
select ok(not private.is_valid_billing_session_url('bps_123','https://billing.stripe.com/p/session/test_','portal'),'portal requires nonempty token');
select ok(not private.is_valid_billing_session_url('bps_123','https://billing.stripe.com/p/session/test_A?x=1','portal'),'portal rejects query');
select ok(not private.is_valid_billing_session_url('bps_123','https://billing.stripe.com/p/session/test_A#x','portal'),'portal rejects fragment');
select ok(not private.is_valid_billing_session_url('bps_123','https://billing.stripe.com:8443/p/session/test_A','portal'),'portal rejects nondefault port');
select ok(not private.is_valid_billing_session_url('bps_123','https://billing.stripe.com@evil.example/p/session/test_A','portal'),'portal rejects credential host trick');
select ok(not private.is_valid_billing_session_url('not_bps','https://billing.stripe.com/p/session/test_A','portal'),'portal rejects noncanonical object ID');

select * from finish();
rollback;
