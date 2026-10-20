-- Make migration 097's ordered LIMIT 100 retention queries physically
-- bounded without changing their service-only function contracts.

create index abuse_rate_limits_expiry_cleanup_idx
  on private.abuse_rate_limits(expires_at,scope,subject_digest,address_digest);

create index bot_token_receipts_expiry_cleanup_idx
  on private.bot_token_receipts(expires_at,action,token_digest);
