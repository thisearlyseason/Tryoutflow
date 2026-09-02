begin;

set local search_path=extensions,public;
select plan(11);

select has_function(
  'public','public_registration_tryout_v2',array['text'],
  'public registration branding remains behind one bounded route RPC'
);
select is(
  pg_catalog.pg_get_function_result(
    to_regprocedure('public.public_registration_tryout_v2(text)')
  ),
  'TABLE(tryout_id uuid, name text, slug text, form_schema jsonb, divisions jsonb, positions jsonb, organization_name text, organization_slug text, logo_exists boolean)',
  'public configuration adds only safe organization name slug and logo presence'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
    where oid=to_regprocedure('public.public_registration_tryout_v2(text)')),
  true,
  'public registration branding stays inside the security-definer boundary'
);
select is(
  (select proconfig from pg_catalog.pg_proc
    where oid=to_regprocedure('public.public_registration_tryout_v2(text)')),
  array['search_path=""']::text[],
  'public registration branding pins an empty search path'
);
select is(
  (select provolatile from pg_catalog.pg_proc
    where oid=to_regprocedure('public.public_registration_tryout_v2(text)')),
  's'::"char",
  'public registration branding remains stable and read only'
);

select function_privs_are(
  'public','public_registration_tryout_v2',array['text'],'service_role',array['EXECUTE'],
  'only the same-origin server route can load public registration branding'
);
select function_privs_are(
  'public','public_registration_tryout_v2',array['text'],'anon',array[]::text[],
  'anonymous clients cannot invoke the branding projection directly'
);
select function_privs_are(
  'public','public_registration_tryout_v2',array['text'],'authenticated',array[]::text[],
  'authenticated clients cannot bypass the same-origin branding route'
);
select is(
  (select count(*) from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))
    ) acl
    where routine.oid=to_regprocedure('public.public_registration_tryout_v2(text)')
      and acl.grantee=0),
  0::bigint,
  'PUBLIC receives no registration branding execution privilege'
);
select table_privs_are(
  'private','organization_brand_assets','service_role',array[]::text[],
  'service role still cannot query logo rows outside guarded RPCs'
);
select table_privs_are(
  'private','organization_brand_assets','anon',array[]::text[],
  'public branding adds no anonymous logo table path'
);

select * from finish();
rollback;
