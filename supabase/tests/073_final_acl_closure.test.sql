begin;

set local search_path=extensions,public;

select plan(26);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join unnest(array['anon','authenticated','service_role']) as caller(role_name)
    cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) as unsafe(privilege_name)
    where namespace.nspname in('public','private')
      and relation.relkind in('r','p','v','m','S')
      and has_table_privilege(caller.role_name,relation.oid,unsafe.privilege_name)
  ),
  0::bigint,
  'named API roles have no unsafe relation privilege in public or private'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) as direct(privilege_name)
    where namespace.nspname in('public','private')
      and relation.relkind in('r','p','v','m','S')
      and has_table_privilege('service_role',relation.oid,direct.privilege_name)
  ),
  0::bigint,
  'service role has no direct table data path around RPC authorization'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in('public','private')
      and relation.relkind in('r','p')
      and not relation.relrowsecurity
  ),
  0::bigint,
  'every application table has row level security enabled'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname in('public','private')
      and routine.prosecdef
      and coalesce(routine.proconfig,array[]::text[]) <> array['search_path=""']::text[]
  ),
  0::bigint,
  'every security-definer application routine pins an empty search path'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_default_acl defaults
    join pg_catalog.pg_roles owner_role on owner_role.oid=defaults.defaclrole
    left join pg_catalog.pg_namespace namespace on namespace.oid=defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) expanded
    left join pg_catalog.pg_roles grantee on grantee.oid=expanded.grantee
    where owner_role.oid in(
        select relation.relowner from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace object_namespace on object_namespace.oid=relation.relnamespace
        where object_namespace.nspname in('public','private')
        union
        select routine.proowner from pg_catalog.pg_proc routine
        join pg_catalog.pg_namespace object_namespace on object_namespace.oid=routine.pronamespace
        where object_namespace.nspname in('public','private')
      )
      and (namespace.nspname in('public','private') or namespace.nspname is null)
      and (expanded.grantee=0 or grantee.rolname in('anon','authenticated','service_role'))
  ),
  0::bigint,
  'future objects from every current application-object owner do not inherit named API-role privileges'
);

select is(
  (
    select array_agg(distinct owner_role.rolname order by owner_role.rolname)
    from (
      select relation.relowner as owner_id from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname in('public','private')
      union
      select routine.proowner from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
      where namespace.nspname in('public','private')
    ) owner_ids
    join pg_catalog.pg_roles owner_role on owner_role.oid=owner_ids.owner_id
  ),
  array['postgres']::name[],
  'the migration role with closed defaults owns every application object'
);

select is(
  (
    select count(*) from (
      select namespace.nspname,expanded.privilege_type
      from pg_catalog.pg_namespace namespace
      cross join lateral aclexplode(coalesce(namespace.nspacl,acldefault('n',namespace.nspowner))) expanded
      where namespace.nspname in('public','private') and expanded.grantee=0
      union all
      select namespace.nspname||'.'||relation.relname,expanded.privilege_type
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      cross join lateral aclexplode(coalesce(relation.relacl,acldefault(
        case when relation.relkind='S' then 'S'::"char" else 'r'::"char" end,relation.relowner
      ))) expanded
      where namespace.nspname in('public','private') and relation.relkind in('r','p','v','m','f','S')
        and expanded.grantee=0
      union all
      select namespace.nspname||'.'||routine.proname,expanded.privilege_type
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
      cross join lateral aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) expanded
      where namespace.nspname in('public','private') and expanded.grantee=0
    ) public_acl
  ),
  0::bigint,
  'PUBLIC has no privilege on either application schema or any application object'
);

select is(
  (
    with expected(role_name,schema_name,relation_name,privilege_name) as (
      select 'authenticated','public',relation_name,'SELECT'
      from unnest(array[
        'athlete_flags','athlete_guardians','athlete_import_previews','athletes','audit_logs',
        'communication_messages','decision_history','evaluation_note_tags','evaluation_notes',
        'evaluation_scores','evaluations','external_entity_mappings','guardians',
        'integration_connections','integration_sync_items','integration_sync_jobs',
        'organization_evaluation_note_tags','organization_members','organizations','profiles',
        'registration_duplicate_candidates','registration_form_versions','registration_forms',
        'roster_assignments','roster_decisions','roster_versions','rubrics','rubric_categories',
        'rubric_versions','seasons','session_enrollments','session_groups','session_rubrics',
        'subscription_accounts','tryout_divisions','tryout_positions','tryout_registrations',
        'tryout_sessions','tryout_setup_progress','tryout_staff_assignments','tryout_teams','tryouts'
      ]::text[]) relation_name
      union all select 'authenticated','public','organizations','UPDATE'
    ), actual as (
      select grantee.rolname,namespace.nspname,relation.relname,expanded.privilege_type
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      cross join lateral aclexplode(coalesce(relation.relacl,acldefault(
        case when relation.relkind='S' then 'S'::"char" else 'r'::"char" end,relation.relowner
      ))) expanded
      join pg_catalog.pg_roles grantee on grantee.oid=expanded.grantee
      where namespace.nspname in('public','private') and relation.relkind in('r','p','v','m','f','S')
        and grantee.rolname in('anon','authenticated','service_role')
    )
    select count(*) from (
      (select * from actual except select * from expected)
      union all
      (select * from expected except select * from actual)
    ) differences
  ),
  0::bigint,
  'named API-role relation privileges exactly match the production read-only allowlist'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname in('public','private')
      and routine.prosecdef
      and has_function_privilege('anon',routine.oid,'EXECUTE')
  ),
  0::bigint,
  'anonymous has no security-definer execution path'
);

select is(
  (
    select array_agg(routine.proname order by routine.proname)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname in('public','private')
      and has_function_privilege('anon',routine.oid,'EXECUTE')
  ),
  array['public_health_check']::name[],
  'anonymous executes exactly the coarse public health RPC'
);

select is(
  (
    select array_agg(routine.proname order by routine.proname)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname in('public','private')
      and has_function_privilege('authenticated',routine.oid,'EXECUTE')
  ),
  array[
    'accept_organization_invitation','assign_evaluator','assign_tryout_number',
    'begin_support_elevation','can_access_evaluation','can_manage_session_group',
    'can_manage_tryout_division','can_manage_tryout_root','can_manage_tryout_session',
    'can_read_full_athlete_pii','can_read_full_registration_pii','can_read_roster',
    'can_read_tenant_record','can_read_tryout_configuration','can_select_director_flag',
    'can_select_own_evaluation','change_organization_member','change_roster_decisions',
    'check_in_registration','check_in_registration_v2','commit_athlete_import',
    'complete_evaluation','configure_evaluation_note_tag','confirm_roster_export_preview_v4',
    'create_athlete_import_preview','create_decision_message_batch_v2',
    'create_organization_invitation','create_organization_with_owner',
    'create_registration_form_revision','create_roster_draft','create_rubric_revision',
    'create_staff_registration','create_tryout_draft_with_cycle',
    'enqueue_analytics_event','finalize_roster_version','get_organization_logo_metadata',
    'get_owned_subscription_account',
    'has_active_configuration_assignment','is_active_organization_member','issue_checkin_qr_token',
    'issue_roster_export_source',
    'list_assigned_athletes','list_communication_templates_for_notice',
    'list_manageable_evaluator_assignments','list_organization_evaluators',
    'list_returning_athletes','list_tryout_evaluator_candidates','load_live_dashboard',
    'load_onboarding_facts','load_ranking_snapshot','load_report_export','load_report_summary',
    'load_roster_workspace','load_staff_registration_configuration','lock_evaluation',
    'manage_director_evaluation_flag','move_roster_athlete','platform_health',
    'platform_list_audit_events','platform_list_organizations','platform_list_subscriptions',
    'platform_list_support_elevations','preview_decision_message_batch_v2','public_health_check',
    'publish_registration_form_version','publish_rubric_version','publish_tryout',
    'purge_expired_athlete_import_previews','queue_invitation_communication_v2',
    'queue_registration_communication_v2','queue_roster_decision_communication_v2',
    'release_tryout_number','remove_organization_logo','reopen_evaluation',
    'reserve_subscription_checkout_intent','resolve_athlete_import_duplicate',
    'resolve_registration_duplicate','retry_integration_sync_job_v4','revise_roster_version',
    'revoke_evaluator_assignment','save_communication_template','save_evaluation_draft',
    'save_integration_connection','save_roster_export_preview_v2','save_tryout_setup_step',
    'save_tryout_wizard_configuration','search_checkin_registrations',
    'search_checkin_registrations_v2','select_tryout_registration_form_version',
    'sync_evaluation_mutation','transfer_organization_ownership','transition_tryout_lifecycle',
    'validate_tryout_for_publish'
  ]::name[],
  'authenticated executes exactly the current production RPC allowlist'
);

select function_privs_are('public','public_health_check',array[]::text[],'anon',array['EXECUTE'],'anonymous can execute only coarse health');
select function_privs_are('public','create_tryout_draft',array['uuid','uuid','text','text','text','text','timestamp with time zone','timestamp with time zone'],'authenticated',array[]::text[],'the obsolete cycle-less tryout command has no authenticated execution grant');
select function_privs_are('public','create_organization_invitation',array['uuid','text','text','text','timestamp with time zone','uuid'],'authenticated',array['EXECUTE'],'invitation creation uses a guarded RPC');
select function_privs_are('public','change_organization_member',array['uuid','uuid','text','text','bigint','uuid'],'authenticated',array['EXECUTE'],'member changes use a guarded versioned RPC');
select function_privs_are('public','transfer_organization_ownership',array['uuid','uuid','bigint','bigint','uuid'],'authenticated',array['EXECUTE'],'ownership transfer uses a guarded versioned RPC');
select table_privs_are('public','organization_members','authenticated',array['SELECT'],'members are read-only to authenticated clients');
select table_privs_are('public','organization_invitations','authenticated',array[]::text[],'invitations have no direct client table path');
select table_privs_are('public','organizations','authenticated',array['SELECT','UPDATE'],'organization settings retain the exact current direct mutation path');
select is(
  (
    select array_agg(format('%s.%s:%s',namespace.nspname,relation.relname,direct.privilege_name)
                     order by namespace.nspname,relation.relname,direct.privilege_name)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join unnest(array['INSERT','UPDATE','DELETE']) as direct(privilege_name)
    where namespace.nspname in('public','private')
      and relation.relkind in('r','p','v','m')
      and has_table_privilege('authenticated',relation.oid,direct.privilege_name)
  ),
  array['public.organizations:UPDATE']::text[],
  'authenticated has only the audited organization-settings table mutation path'
);
select table_privs_are('private','abuse_rate_limits','service_role',array[]::text[],'rate-limit state is accessible only through its command');
select table_privs_are('private','bot_token_receipts','service_role',array[]::text[],'bot replay evidence is inaccessible directly');

select is(
  (
    select array_agg(routine.proname order by routine.proname)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname='public' and has_function_privilege('service_role',routine.oid,'EXECUTE')
  ),
  array[
    'apply_resend_delivery_event','apply_stripe_subscription_event',
    'authorize_integration_outbox_submission','authorize_outbox_job_send_v2',
    'claim_integration_outbox_jobs','claim_outbox_jobs','complete_integration_outbox_job',
    'complete_outbox_job_v2','complete_subscription_checkout_intent','consume_abuse_rate_limit',
    'consume_bot_token_once','consume_public_registration_rate_limit',
    'consume_registration_confirmation_token','create_decision_message_batch_v2',
    'decline_outbox_job_send_v2',
    'fail_integration_outbox_job','fail_outbox_job_v2','fail_subscription_checkout_intent',
    'public_registration_tryout_v2','purge_expired_communication_previews',
    'purge_expired_integration_previews','purge_expired_subscription_checkout_intents',
    'queue_invitation_communication_v2','queue_registration_confirmation_communication_v2',
    'read_organization_logo_service','record_outbox_job_delivery_uncertain_v2',
    'reissue_registration_confirmation_token','submit_public_registration_v2',
    'upsert_organization_logo_service','validate_integration_outbox_execution'
  ]::name[],
  'service role executes only the audited worker and public-route RPC set'
);

select is(
  (
    select count(distinct trigger.tgrelid)
    from pg_catalog.pg_trigger trigger
    where trigger.tgisinternal is false
      and trigger.tgtype & 32 = 32
      and trigger.tgrelid = any(array[
        'public.organizations'::regclass,
        'public.organization_members'::regclass,
        'public.organization_invitations'::regclass,
        'public.audit_logs'::regclass,
        'public.registration_forms'::regclass,
        'public.registration_form_versions'::regclass,
        'public.rubrics'::regclass,
        'public.rubric_versions'::regclass,
        'public.rubric_categories'::regclass,
        'private.abuse_rate_limits'::regclass,
        'private.bot_token_receipts'::regclass
      ])
  ),
  11::bigint,
  'security-critical organization and configuration relations reject truncation'
);

select throws_ok($$set local role authenticated; truncate table public.organizations$$,'42501',null,'authenticated cannot truncate organizations');
select throws_ok($$set local role service_role; truncate table public.organization_members$$,'42501',null,'service role cannot truncate memberships');

select * from finish();
rollback;
