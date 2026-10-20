begin;
select plan(8);

select has_column('public','checkins','assigned_number_snapshot','receipts snapshot the assigned number');
select col_not_null('public','checkins','assigned_number_snapshot','every receipt has an immutable assigned-number snapshot');
select has_column('public','session_groups','division_id','groups carry their parent division identity');
select ok(exists(
  select 1 from pg_constraint
  where conrelid='public.tryout_numbers'::regclass and contype='f'
    and pg_get_constraintdef(oid) like '%organization_id, tryout_id, division_id, session_id%'
),'number assignments bind session to division with one foreign key');
select ok(exists(
  select 1 from pg_constraint
  where conrelid='public.tryout_numbers'::regclass and contype='f'
    and pg_get_constraintdef(oid) like '%organization_id, tryout_id, division_id, session_id, group_id%'
),'number assignments bind group, session, and division with one foreign key');
select has_index('public','checkin_qr_tokens','checkin_qr_one_active_registration_key','only one active QR token can exist per registration');
select has_function('public','audit_checkin_number_release','system-triggered releases share one append-only audit boundary');
select is((select count(*) from information_schema.routine_privileges
  where routine_schema='public' and routine_name='audit_checkin_number_release'
    and grantee in ('PUBLIC','anon','authenticated')),0::bigint,'the lifecycle audit helper is not callable as an RPC');

select * from finish();
rollback;
