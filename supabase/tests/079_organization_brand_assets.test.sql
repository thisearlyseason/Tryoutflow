begin;

set local search_path=extensions,public;
select no_plan();

select has_table('private','organization_brand_assets','private brand assets exist');
select columns_are('private','organization_brand_assets',array[
  'organization_id','content','content_type','byte_length','sha256',
  'updated_by_user_id','created_at','updated_at'
], 'brand assets expose only the exact durable columns');
select is((
  select array_agg(
    column_name||':'||data_type||':'||is_nullable
    order by ordinal_position
  )
  from information_schema.columns
  where table_schema='private' and table_name='organization_brand_assets'
),array[
  'organization_id:uuid:NO','content:bytea:NO','content_type:text:NO',
  'byte_length:integer:NO','sha256:text:NO','updated_by_user_id:uuid:NO',
  'created_at:timestamp with time zone:NO','updated_at:timestamp with time zone:NO'
]::text[],'brand asset column types and nullability remain exact');
select col_is_pk('private','organization_brand_assets','organization_id','one logo row is owned by each organization');
select has_fk('private','organization_brand_assets','brand assets retain organization and updater ownership');
select is((select count(*) from pg_catalog.pg_constraint
  where conrelid=to_regclass('private.organization_brand_assets') and contype='f'),2::bigint,
  'brand assets have exactly the organization and updater foreign keys');
select is(coalesce((select relrowsecurity from pg_catalog.pg_class
  where oid=to_regclass('private.organization_brand_assets')),false),true,
  'private brand assets retain defense-in-depth RLS');

select has_function('public','upsert_organization_logo',array['uuid','text','text'],
  'the legacy client byte-taking logo RPC remains catalogued but closed');
select has_function('public','upsert_organization_logo_service',array['uuid','uuid','text','text'],
  'trusted server logo upserts use one live-actor guarded RPC');
select has_function('public','remove_organization_logo',array['uuid'],
  'owner and administrator logo removal uses one guarded RPC');
select has_function('public','read_organization_logo_service',array['text'],
  'server logo delivery uses one byte-reading RPC');
select has_function('public','get_organization_logo_metadata',array['uuid'],
  'authenticated layouts use one byte-free metadata RPC');
select is(pg_catalog.pg_get_function_result(to_regprocedure('public.upsert_organization_logo(uuid,text,text)')),
  'text','logo upsert returns only a closed outcome');
select is(pg_catalog.pg_get_function_result(to_regprocedure('public.upsert_organization_logo_service(uuid,uuid,text,text)')),
  'text','trusted server logo upsert returns only a closed outcome');
select is(pg_catalog.pg_get_function_result(to_regprocedure('public.remove_organization_logo(uuid)')),
  'text','logo removal returns only a closed outcome');
select is(pg_catalog.pg_get_function_result(to_regprocedure('public.read_organization_logo_service(text)')),
  'TABLE(content bytea, content_type text, byte_length integer, sha256 text, updated_at timestamp with time zone)',
  'service logo read returns one exact byte payload and cache metadata');
select is(pg_catalog.pg_get_function_result(to_regprocedure('public.get_organization_logo_metadata(uuid)')),
  'TABLE(logo_exists boolean, sha256 text, updated_at timestamp with time zone)',
  'member logo metadata exposes existence digest and version without bytes');

select table_privs_are('private','organization_brand_assets','authenticated',array[]::text[],
  'clients have no direct logo access');
select table_privs_are('private','organization_brand_assets','anon',array[]::text[],
  'anonymous callers have no direct logo access');
select table_privs_are('private','organization_brand_assets','service_role',array[]::text[],
  'service delivery cannot bypass the logo read RPC');
select function_privs_are('public','upsert_organization_logo',array['uuid','text','text'],
  'authenticated',array[]::text[],'authenticated clients cannot submit logo bytes directly');
select function_privs_are('public','upsert_organization_logo_service',array['uuid','uuid','text','text'],
  'service_role',array['EXECUTE'],'only the trusted server boundary can submit normalized bytes');
select function_privs_are('public','upsert_organization_logo_service',array['uuid','uuid','text','text'],
  'authenticated',array[]::text[],'authenticated clients cannot invoke the service mutation command');
select function_privs_are('public','upsert_organization_logo_service',array['uuid','uuid','text','text'],
  'anon',array[]::text[],'anonymous callers cannot invoke the service mutation command');
select function_privs_are('public','remove_organization_logo',array['uuid'],
  'authenticated',array['EXECUTE'],'authenticated uses the guarded removal RPC');
select function_privs_are('public','read_organization_logo_service',array['text'],
  'service_role',array['EXECUTE'],'only the server delivery boundary reads bytes');
select function_privs_are('public','get_organization_logo_metadata',array['uuid'],
  'authenticated',array['EXECUTE'],'active members can load byte-free branding metadata');
select function_privs_are('public','upsert_organization_logo',array['uuid','text','text'],
  'anon',array[]::text[],'anonymous callers cannot mutate logos');
select function_privs_are('public','upsert_organization_logo',array['uuid','text','text'],
  'service_role',array[]::text[],'service delivery cannot mutate logos');
select function_privs_are('public','remove_organization_logo',array['uuid'],
  'anon',array[]::text[],'anonymous callers cannot remove logos');
select function_privs_are('public','remove_organization_logo',array['uuid'],
  'service_role',array[]::text[],'service delivery cannot remove logos');
select function_privs_are('public','read_organization_logo_service',array['text'],
  'anon',array[]::text[],'anonymous callers cannot invoke the byte reader directly');
select function_privs_are('public','read_organization_logo_service',array['text'],
  'authenticated',array[]::text[],'authenticated clients cannot invoke the byte reader directly');
select function_privs_are('public','get_organization_logo_metadata',array['uuid'],
  'anon',array[]::text[],'anonymous callers cannot read logo metadata');
select function_privs_are('public','get_organization_logo_metadata',array['uuid'],
  'service_role',array[]::text[],'service delivery receives no member metadata path');
select is((select count(*) from pg_catalog.pg_proc routine
  where routine.oid in(
    to_regprocedure('public.upsert_organization_logo(uuid,text,text)'),
    to_regprocedure('public.upsert_organization_logo_service(uuid,uuid,text,text)'),
    to_regprocedure('public.remove_organization_logo(uuid)'),
    to_regprocedure('public.read_organization_logo_service(text)'),
    to_regprocedure('public.get_organization_logo_metadata(uuid)')
  ) and routine.prosecdef and routine.proconfig=array['search_path=""']::text[]),5::bigint,
  'all public logo boundaries are security definer with fixed empty search paths');
select is((select count(*) from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
  cross join lateral pg_catalog.aclexplode(coalesce(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl
  where namespace.nspname='public'
    and routine.proname in('upsert_organization_logo','upsert_organization_logo_service','remove_organization_logo',
      'read_organization_logo_service','get_organization_logo_metadata')
    and acl.grantee=0),0::bigint,'PUBLIC receives no logo RPC execution privilege');

insert into auth.users(id,email,email_confirmed_at) values
  ('79000000-0000-4000-8000-000000000001','logo-owner@example.test',clock_timestamp()),
  ('79000000-0000-4000-8000-000000000002','logo-admin@example.test',clock_timestamp()),
  ('79000000-0000-4000-8000-000000000003','logo-member@example.test',clock_timestamp()),
  ('79000000-0000-4000-8000-000000000004','logo-offboarded@example.test',clock_timestamp()),
  ('79000000-0000-4000-8000-000000000005','other-owner@example.test',clock_timestamp());
insert into public.organizations(id,name,slug) values
  ('79100000-0000-4000-8000-000000000001','Logo Organization A','logo-organization-a'),
  ('79100000-0000-4000-8000-000000000002','Logo Organization B','logo-organization-b');
insert into public.organization_members(id,organization_id,user_id,role,status) values
  ('79200000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000001','owner','active'),
  ('79200000-0000-4000-8000-000000000002','79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002','administrator','active'),
  ('79200000-0000-4000-8000-000000000003','79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000003','member','active'),
  ('79200000-0000-4000-8000-000000000004','79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000004','administrator','disabled'),
  ('79200000-0000-4000-8000-000000000005','79100000-0000-4000-8000-000000000002','79000000-0000-4000-8000-000000000005','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.upsert_organization_logo(
  '79100000-0000-4000-8000-000000000001','UklGRgQAAABXRUJQ',
  '3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452'
)$$,'42501',null,'an authenticated owner cannot bypass normalization through the legacy byte RPC');
select throws_ok($$select public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000001',
  'UklGRgQAAABXRUJQ','3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452'
)$$,'42501',null,'an authenticated owner cannot call the service mutation command directly');
reset role;
select is((select count(*) from private.organization_brand_assets
  where organization_id='79100000-0000-4000-8000-000000000001'),0::bigint,
  'direct authenticated pseudo-WebP attempts cannot store corrupt bytes');
set local role service_role;
select is(public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000001',
  'UklGRgQAAABXRUJQ','3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452'
),'updated','the trusted server command stores bytes for a currently active owner actor');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000001',true);
select throws_ok($$select * from private.organization_brand_assets$$,'42501',null,
  'authenticated clients cannot select logo bytes directly');
select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000002',decode('524946460400000057454250','hex'),
  'image/webp',12,'3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452',
  '79000000-0000-4000-8000-000000000001'
)$$,'42501',null,'authenticated clients cannot insert logo bytes directly');
select throws_ok($$update private.organization_brand_assets set sha256=repeat('0',64)$$,
  '42501',null,'authenticated clients cannot update logo bytes directly');
select throws_ok($$delete from private.organization_brand_assets$$,
  '42501',null,'authenticated clients cannot delete logo bytes directly');
select throws_ok($$truncate table private.organization_brand_assets$$,
  '42501',null,'authenticated clients cannot truncate logo bytes directly');
select throws_ok($$select * from public.read_organization_logo_service('logo-organization-a')$$,
  '42501',null,'authenticated callers cannot reach the service byte reader');

select is((select logo_exists::text||':'||sha256||':'||(updated_at is not null)::text
  from public.get_organization_logo_metadata('79100000-0000-4000-8000-000000000001')),
  'true:3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452:true',
  'authorized metadata returns existence digest and version without bytes');
select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000003',true);
select is((select sha256 from public.get_organization_logo_metadata(
  '79100000-0000-4000-8000-000000000001')),
  '3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452',
  'an active ordinary member can load byte-free logo metadata');
select throws_ok($$select public.upsert_organization_logo(
  '79100000-0000-4000-8000-000000000001','UklGRgUAAABXRUJQAA==',
  '417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
)$$,'42501',null,'an ordinary member cannot call the legacy logo byte RPC');
select throws_ok($$select public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000003',
  'UklGRgUAAABXRUJQAA==','417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
)$$,'42501',null,'an ordinary member cannot call the service logo byte RPC');
select is(public.remove_organization_logo('79100000-0000-4000-8000-000000000001'),
  'forbidden','an ordinary member cannot remove the logo');

select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.upsert_organization_logo(
  '79100000-0000-4000-8000-000000000001','UklGRgUAAABXRUJQAA==',
  '417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
)$$,'42501',null,'an offboarded administrator cannot call the legacy logo byte RPC');
select throws_ok($$select * from public.get_organization_logo_metadata(
  '79100000-0000-4000-8000-000000000001')$$,'42501',null,
  'an offboarded member cannot read logo metadata');

select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.upsert_organization_logo(
  '79100000-0000-4000-8000-000000000001','UklGRgUAAABXRUJQAA==',
  '417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
)$$,'42501',null,'cross-tenant owners cannot call the legacy logo byte RPC');
select throws_ok($$select * from public.get_organization_logo_metadata(
  '79100000-0000-4000-8000-000000000001')$$,'42501',null,
  'cross-tenant owners cannot read logo metadata');
select is((select logo_exists::text||':'||coalesce(sha256,'null')||':'||
    coalesce(updated_at::text,'null')
  from public.get_organization_logo_metadata('79100000-0000-4000-8000-000000000002')),
  'false:null:null','authorized metadata returns exactly one explicit missing-logo row');

select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000002',true);
select set_config('app.test.logo_first_updated_at',(select updated_at::text
  from public.get_organization_logo_metadata('79100000-0000-4000-8000-000000000001')),true);
reset role;
set local role service_role;
select is(public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002',
  'UklGRgUAAABXRUJQAA==','417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
),'updated','the trusted server command can atomically replace for a live administrator actor');
select is(public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000004',
  'UklGRgQAAABXRUJQAA==','417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
),'forbidden','the trusted server command independently denies an offboarded actor');
select is(public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000003',
  'UklGRgQAAABXRUJQAA==','417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
),'forbidden','the trusted server command independently denies an ordinary member actor');
select is(public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000005',
  'UklGRgQAAABXRUJQAA==','417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0'
),'forbidden','the trusted server command independently denies a cross-tenant actor');
select throws_ok($$select public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','not-a-uuid',
  'UklGRgQAAABXRUJQ',repeat('0',64)
)$$,'22P02',null,'an invalid actor UUID fails closed before byte processing');
select throws_ok($$select public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002',
  'not-base64',repeat('0',64)
)$$,'22023',null,'malformed base64 fails closed');
select throws_ok($$select public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002',
  'bm90IHdlYnA=',
  '58614bb635a7dfd6518d4d25aa5cafe381e253f5f62df05d2b5deac873b6b183'
)$$,'22023',null,'decoded bytes without the RIFF WEBP header fail closed');
select throws_ok($$select public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000002',
  'UklGRgQAAABXRUJQ',repeat('0',64)
)$$,'22023',null,'a digest that does not match the decoded bytes fails closed');
select throws_ok($$select public.upsert_organization_logo_service(
  '79100000-0000-4000-8000-000000000001',
  '79000000-0000-4000-8000-000000000002',
  translate(encode(decode('524946460400000057454250','hex')||decode(repeat('00',349989),'hex'),'base64'),E'\n',''),
  encode(digest(decode('524946460400000057454250','hex')||decode(repeat('00',349989),'hex'),'sha256'),'hex')
)$$,'22023',null,'decoded WebP bytes above 350000 bytes fail closed');
reset role;

select is((select count(*) from private.organization_brand_assets
  where organization_id='79100000-0000-4000-8000-000000000001'),1::bigint,
  'logo replacement preserves one row per organization');
select is((select content_type||':'||byte_length::text||':'||sha256||':'||updated_by_user_id::text
  from private.organization_brand_assets
  where organization_id='79100000-0000-4000-8000-000000000001'),
  'image/webp:13:417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0:79000000-0000-4000-8000-000000000002',
  'the durable row stores normalized content metadata and the updater identity');
select ok((select updated_at>current_setting('app.test.logo_first_updated_at')::timestamptz
  from private.organization_brand_assets
  where organization_id='79100000-0000-4000-8000-000000000001'),
  'replacement advances the cache/display version');
select is((select count(*) from public.audit_logs
  where organization_id='79100000-0000-4000-8000-000000000001'
    and action='organization.logo_updated'),2::bigint,
  'only successful owner and administrator writes append logo update audit evidence');
select is((select array_agg(actor_user_id order by actor_user_id) from public.audit_logs
  where organization_id='79100000-0000-4000-8000-000000000001'
    and action='organization.logo_updated'),array[
      '79000000-0000-4000-8000-000000000001'::uuid,
      '79000000-0000-4000-8000-000000000002'::uuid
    ],'logo audit evidence preserves the exact successful actors');
select throws_ok($$update public.audit_logs set action='organization.logo_removed'
  where organization_id='79100000-0000-4000-8000-000000000001'
    and action='organization.logo_updated'$$,'55000',null,
  'logo mutation audit evidence remains append-only');

select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000002',decode('524946460400000057454250','hex'),
  'image/png',12,'3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452',
  '79000000-0000-4000-8000-000000000005'
)$$,'23514',null,'durable content is WebP only');
select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000002',decode('524946460400000057454250','hex'),
  'image/webp',11,'3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452',
  '79000000-0000-4000-8000-000000000005'
)$$,'23514',null,'declared logo byte length must match durable bytes');
select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000002',decode('52494646040000004e4f5045','hex'),
  'image/webp',12,'20a6e2470fd52aa8e1bc348e850c987592f1adde7521ee4723a770e18d82b76e',
  '79000000-0000-4000-8000-000000000005'
)$$,'23514',null,'durable logo bytes require both RIFF and WEBP magic');
select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000002',decode('524946460400000057454250','hex'),
  'image/webp',12,upper('3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452'),
  '79000000-0000-4000-8000-000000000005'
)$$,'23514',null,'durable digests require 64 lowercase hexadecimal characters');
select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000002',
  decode('524946460400000057454250','hex')||decode(repeat('00',349989),'hex'),
  'image/webp',350001,
  encode(digest(decode('524946460400000057454250','hex')||decode(repeat('00',349989),'hex'),'sha256'),'hex'),
  '79000000-0000-4000-8000-000000000005'
)$$,'23514',null,'durable logo bytes cannot exceed the 350000-byte encoded ceiling');
select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000002',decode('524946460400000057454250','hex'),
  'image/webp',12,repeat('0',64),'79000000-0000-4000-8000-000000000005'
)$$,'23514',null,'durable digest identity must match the exact bytes');
select throws_ok($$insert into private.organization_brand_assets(
  organization_id,content,content_type,byte_length,sha256,updated_by_user_id
) values(
  '79100000-0000-4000-8000-000000000001',decode('524946460400000057454250','hex'),
  'image/webp',12,'3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452',
  '79000000-0000-4000-8000-000000000001'
)$$,'23505',null,'one organization cannot own multiple durable logo rows');
select throws_ok($$update private.organization_brand_assets
  set organization_id='79100000-0000-4000-8000-000000000002'
  where organization_id='79100000-0000-4000-8000-000000000001'$$,
  '55000',null,'durable logo organization identity is immutable');

set local role service_role;
select is((select count(*) from public.read_organization_logo_service('logo-organization-a')),
  1::bigint,'the service reader returns exactly one existing logo row');
select is((select encode(content,'hex')||':'||content_type||':'||byte_length::text||':'||sha256||':'||
    (updated_at is not null)::text
  from public.read_organization_logo_service('logo-organization-a')),
  '52494646050000005745425000:image/webp:13:417118f1801e212f1e83d88f6f268e3570a9f1a72019d799931bb4a9976470d0:true',
  'the service reader returns exact bytes and bounded cache metadata');
select is((select count(*) from public.read_organization_logo_service('logo-organization-b')),
  0::bigint,'the service reader returns zero rows for a missing logo');
select throws_ok($$select public.upsert_organization_logo(
  '79100000-0000-4000-8000-000000000001','UklGRgQAAABXRUJQ',
  '3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452'
)$$,'42501',null,'the service role cannot invoke owner-scoped mutations');
select throws_ok($$select * from public.get_organization_logo_metadata(
  '79100000-0000-4000-8000-000000000001')$$,'42501',null,
  'the service role cannot invoke member-scoped metadata');
reset role;

select throws_ok($$truncate table private.organization_brand_assets$$,
  '55000',null,'the table owner cannot truncate durable logos');
set local session_replication_role=replica;
select throws_ok($$truncate table private.organization_brand_assets$$,
  '55000',null,'replica mode cannot bypass durable logo truncation protection');
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000001',true);
select is(public.remove_organization_logo('79100000-0000-4000-8000-000000000001'),
  'removed','an owner can remove the organization logo');
select is(public.remove_organization_logo('79100000-0000-4000-8000-000000000001'),
  'not_found','removing an already absent logo returns the closed not-found outcome');
reset role;
select is((select count(*) from private.organization_brand_assets
  where organization_id='79100000-0000-4000-8000-000000000001'),0::bigint,
  'successful removal deletes the exact organization logo');
select is((select count(*) from public.audit_logs
  where organization_id='79100000-0000-4000-8000-000000000001'
    and action='organization.logo_removed'),1::bigint,
  'only successful removal appends immutable audit evidence');

select * from finish();
rollback;
