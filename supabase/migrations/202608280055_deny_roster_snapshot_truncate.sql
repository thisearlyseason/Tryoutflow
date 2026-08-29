-- TRUNCATE is table-wide and bypasses row-level immutability triggers. These
-- five tables form one durable roster snapshot/lineage boundary, so there is
-- no row-scoped TRUNCATE that can be safe. Deny it unconditionally, including
-- for the table owner and while session_replication_role is replica.

create function private.deny_roster_snapshot_truncate() returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'roster snapshot and lineage tables cannot be truncated'
    using errcode='55000';
end;
$$;

create trigger deny_roster_assignments_truncate
before truncate on public.roster_assignments
for each statement execute function private.deny_roster_snapshot_truncate();

create trigger deny_roster_decisions_truncate
before truncate on public.roster_decisions
for each statement execute function private.deny_roster_snapshot_truncate();

create trigger deny_decision_history_truncate
before truncate on public.decision_history
for each statement execute function private.deny_roster_snapshot_truncate();

create trigger deny_roster_versions_truncate
before truncate on public.roster_versions
for each statement execute function private.deny_roster_snapshot_truncate();

create trigger deny_tryout_teams_truncate
before truncate on public.tryout_teams
for each statement execute function private.deny_roster_snapshot_truncate();

alter table public.roster_assignments enable always trigger deny_roster_assignments_truncate;
alter table public.roster_decisions enable always trigger deny_roster_decisions_truncate;
alter table public.decision_history enable always trigger deny_decision_history_truncate;
alter table public.roster_versions enable always trigger deny_roster_versions_truncate;
alter table public.tryout_teams enable always trigger deny_tryout_teams_truncate;

revoke all privileges on table
  public.tryout_teams,
  public.roster_versions,
  public.roster_assignments,
  public.roster_decisions,
  public.decision_history
from public,anon,authenticated,service_role;

grant select on table
  public.tryout_teams,
  public.roster_versions,
  public.roster_assignments,
  public.roster_decisions,
  public.decision_history
to authenticated;

revoke all on function private.deny_roster_snapshot_truncate()
from public,anon,authenticated,service_role;
