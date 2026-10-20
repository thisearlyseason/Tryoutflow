-- Private data is accessible only through the existing authorized, owner-executed RPCs.
-- Preserve that boundary if a future migration accidentally grants direct table access.
alter table private.athlete_portraits enable row level security;
alter table private.performance_exports enable row level security;
alter table private.pro_trials enable row level security;
alter table private.talent_record_revisions enable row level security;
