begin;
select plan(10);

select has_trigger('public','session_enrollments','a_lock_session_enrollment_registration',
  'enrollment mutations retain the registration-parent lock trigger');
select function_privs_are('public','lock_session_enrollment_registration',array[]::text[],'anon',array[]::text[],
  'anonymous cannot invoke the parent-lock trigger helper');
select function_privs_are('public','lock_session_enrollment_registration',array[]::text[],'authenticated',array[]::text[],
  'authenticated clients cannot invoke the parent-lock trigger helper');
select function_privs_are('public','lock_session_enrollment_registration',array[]::text[],'service_role',array[]::text[],
  'service role cannot invoke the parent-lock trigger helper');
select ok(position('order by target.organization_id,target.registration_id' in
  pg_get_functiondef('public.lock_session_enrollment_registration()'::regprocedure))>0,
  'reparenting locks old and new registrations in global order');
select ok(position('for update of registration' in
  pg_get_functiondef('public.lock_session_enrollment_registration()'::regprocedure))>0,
  'the enrollment trigger locks registration parents');
select ok(position('session_enrollments enrollment' in
  pg_get_functiondef('public.assign_tryout_number(uuid,uuid,uuid,uuid,uuid,uuid,text,integer)'::regprocedure))=0,
  'assignment never takes an enrollment tuple lock after its parent');
select ok(position('session_enrollments enrollment' in
  pg_get_functiondef('public.release_tryout_number(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure))=0,
  'release never takes an enrollment tuple lock after its parent');
select ok(position('for update nowait' in
  pg_get_functiondef('public.check_in_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure))>0,
  'check-in uses NOWAIT for the optional existing-group correction');
select ok(position('when lock_not_available' in
  pg_get_functiondef('public.check_in_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure))>0,
  'a conflicting older mover becomes a retry outcome rather than a lock wait');

select * from finish();
rollback;
