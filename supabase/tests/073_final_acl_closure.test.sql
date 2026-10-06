begin;

set local search_path=extensions,public;

select plan(26);

-- Exact allowlists include the reviewed talent, billing, and team-workspace grants
-- in migrations 119-163, including the scoped account-deletion request/worker RPCs.
-- Keep these static: unexpected future grants must fail.

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
        'athlete_corrections',
        'athlete_flags',
        'athlete_guardians',
        'athlete_import_previews',
        'athlete_sport_profiles',
        'athletes',
        'audit_logs',
        'billing_audit_log',
        'billing_contracts',
        'billing_overrides',
        'billing_products',
        'communication_messages',
        'decision_history',
        'eligibility_exceptions',
        'evaluation_note_tags',
        'evaluation_notes',
        'evaluation_scores',
        'evaluations',
        'evaluator_sport_profiles',
        'event_eligibility_policies',
        'event_fees',
        'event_notices',
        'external_entity_mappings',
        'guardians',
        'integration_connections',
        'integration_sync_items',
        'integration_sync_jobs',
        'organization_evaluation_note_tags',
        'organization_members',
        'organizations',
        'participant_links',
        'performance_metrics',
        'performance_results',
        'profiles',
        'registration_duplicate_candidates',
        'registration_form_versions',
        'registration_forms',
        'roster_assignments',
        'roster_decisions',
        'roster_scenario_members',
        'roster_scenarios',
        'roster_versions',
        'rubric_categories',
        'rubric_versions',
        'rubrics',
        'scouting_grants',
        'scouting_records',
        'seasons',
        'session_enrollments',
        'session_groups',
        'session_rubrics',
        'subscription_accounts',
        'tryout_divisions',
        'tryout_positions',
        'tryout_registrations',
        'tryout_sessions',
        'tryout_setup_progress',
        'tryout_staff_assignments',
        'tryout_stations',
        'tryout_teams',
        'tryouts'
      ]::text[]) relation_name
      union all select 'authenticated','public','athlete_corrections','INSERT'
      union all select 'authenticated','public','athlete_corrections','UPDATE'
      union all select 'authenticated','public','athlete_sport_profiles','INSERT'
      union all select 'authenticated','public','athlete_sport_profiles','UPDATE'
      union all select 'authenticated','public','evaluator_sport_profiles','INSERT'
      union all select 'authenticated','public','evaluator_sport_profiles','UPDATE'
      union all select 'authenticated','public','event_fees','INSERT'
      union all select 'authenticated','public','event_fees','UPDATE'
      union all select 'authenticated','public','event_notices','INSERT'
      union all select 'authenticated','public','event_notices','UPDATE'
      union all select 'authenticated','public','organizations','UPDATE'
      union all select 'authenticated','public','participant_links','INSERT'
      union all select 'authenticated','public','participant_links','UPDATE'
      union all select 'authenticated','public','performance_metrics','INSERT'
      union all select 'authenticated','public','performance_metrics','UPDATE'
      union all select 'authenticated','public','performance_results','INSERT'
      union all select 'authenticated','public','performance_results','UPDATE'
      union all select 'authenticated','public','roster_scenario_members','INSERT'
      union all select 'authenticated','public','roster_scenario_members','UPDATE'
      union all select 'authenticated','public','roster_scenarios','INSERT'
      union all select 'authenticated','public','roster_scenarios','UPDATE'
      union all select 'authenticated','public','scouting_grants','DELETE'
      union all select 'authenticated','public','scouting_grants','INSERT'
      union all select 'authenticated','public','scouting_records','INSERT'
      union all select 'authenticated','public','scouting_records','UPDATE'
      union all select 'authenticated','public','tryout_stations','INSERT'
      union all select 'authenticated','public','tryout_stations','UPDATE'
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
  'named API-role relation privileges exactly match the production table allowlist'
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
    'accept_organization_invitation',
    'assign_evaluator',
    'assign_tryout_number',
    'begin_support_elevation',
    'build_performance_export',
    'calibration_workspace',
    'can_access_evaluation',
    'can_manage_session_group',
    'can_manage_tryout_division',
    'can_manage_tryout_root',
    'can_manage_tryout_session',
    'can_read_full_athlete_pii',
    'can_read_full_registration_pii',
    'can_read_roster',
    'can_read_tenant_record',
    'can_read_tryout_configuration',
    'can_select_director_flag',
    'can_select_own_evaluation',
    'can_use_talent',
    'can_view_participant',
    'change_organization_member',
    'change_roster_decisions',
    'check_in_registration',
    'check_in_registration_v2',
    'clone_published_tryout_revision',
    'commit_athlete_import',
    'complete_evaluation',
    'complete_single_tryout',
    'configure_evaluation_note_tag',
    'confirm_roster_export_preview_v4',
    'create_athlete_import_preview',
    'create_calibration_case',
    'create_decision_message_batch_v2',
    'create_organization_invitation',
    'create_organization_with_owner',
    'create_registration_form_revision',
    'create_roster_draft',
    'create_rubric_revision',
    'create_staff_registration_v2',
    'create_team_workspace',
    'create_tryout_draft_with_cycle',
    'disconnect_integration_connection',
    'download_performance_export',
    'duplicate_tryout',
    'enqueue_analytics_event',
    'event_coverage',
    'finalize_roster_version',
    'get_account_deletion_request',
    'get_billing_dashboard',
    'get_effective_entitlements',
    'get_organization_logo_metadata',
    'get_owned_subscription_account',
    'get_registration_form_configuration',
    'get_registration_notification_settings',
    'get_single_tryout_lifecycle',
    'get_tryout_setup_configuration',
    'get_workspace_navigation',
    'has_active_configuration_assignment',
    'import_performance_results',
    'is_active_organization_member',
    'is_valid_organization_slug',
    'issue_checkin_qr_token',
    'issue_roster_export_source',
    'link_participant',
    'list_assigned_athletes',
    'list_communication_templates_for_notice',
    'list_manageable_evaluator_assignments',
    'list_organization_evaluators',
    'list_organization_invitations',
    'list_performance_exports',
    'list_returning_athletes',
    'list_team_workspaces',
    'list_tryout_evaluator_candidates',
    'load_athlete_evaluation_history',
    'load_athlete_profile_average',
    'load_live_dashboard',
    'load_onboarding_facts',
    'load_ranking_snapshot',
    'load_report_export',
    'load_report_summary',
    'load_roster_workspace',
    'load_staff_registration_configuration',
    'lock_evaluation',
    'manage_billing_override',
    'manage_director_evaluation_flag',
    'move_roster_athlete',
    'participant_offers',
    'participant_registration_options',
    'participant_registration_prefill',
    'participant_schedule',
    'participant_workspace',
    'performance_export_status',
    'platform_account_deletion_requests',
    'platform_health',
    'platform_list_audit_events',
    'platform_list_organizations',
    'platform_list_subscriptions',
    'platform_list_support_elevations',
    'platform_update_account_deletion',
    'preview_decision_message_batch_v2',
    'preview_event_notice',
    'program_attendance',
    'public_health_check',
    'publish_registration_form_version',
    'publish_rubric_version',
    'publish_tryout',
    'purge_expired_athlete_import_previews',
    'queue_event_notice',
    'queue_invitation_communication_v2',
    'queue_registration_communication_v2',
    'queue_roster_decision_communication_v2',
    'read_athlete_portrait',
    'record_billing_analytics',
    'release_tryout_number',
    'remove_organization_logo',
    'reopen_evaluation',
    'request_account_deletion',
    'reserve_billing_purchase',
    'reserve_subscription_checkout_intent',
    'resolve_athlete_import_duplicate',
    'resolve_registration_duplicate',
    'respond_to_offer',
    'retry_integration_sync_job_v4',
    'revise_roster_version',
    'revoke_evaluator_assignment',
    'save_athlete_contact',
    'save_athlete_portrait',
    'save_communication_template',
    'save_eligibility_exception',
    'save_eligibility_policy',
    'save_evaluation_draft',
    'save_integration_connection',
    'save_prospect_identity',
    'save_registration_form_configuration',
    'save_roster_export_preview_v2',
    'save_tryout_setup_step',
    'save_tryout_wizard_configuration',
    'scouting_people',
    'search_checkin_registrations',
    'search_checkin_registrations_v2',
    'select_tryout_registration_form_version',
    'start_performance_export',
    'start_pro_trial',
    'submit_calibration',
    'sync_evaluation_mutation',
    'transfer_organization_ownership',
    'transition_tryout_lifecycle',
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
  array[
    'public.athlete_corrections:INSERT',
    'public.athlete_corrections:UPDATE',
    'public.athlete_sport_profiles:INSERT',
    'public.athlete_sport_profiles:UPDATE',
    'public.evaluator_sport_profiles:INSERT',
    'public.evaluator_sport_profiles:UPDATE',
    'public.event_fees:INSERT',
    'public.event_fees:UPDATE',
    'public.event_notices:INSERT',
    'public.event_notices:UPDATE',
    'public.organizations:UPDATE',
    'public.participant_links:INSERT',
    'public.participant_links:UPDATE',
    'public.performance_metrics:INSERT',
    'public.performance_metrics:UPDATE',
    'public.performance_results:INSERT',
    'public.performance_results:UPDATE',
    'public.roster_scenario_members:INSERT',
    'public.roster_scenario_members:UPDATE',
    'public.roster_scenarios:INSERT',
    'public.roster_scenarios:UPDATE',
    'public.scouting_grants:DELETE',
    'public.scouting_grants:INSERT',
    'public.scouting_records:INSERT',
    'public.scouting_records:UPDATE',
    'public.tryout_stations:INSERT',
    'public.tryout_stations:UPDATE'
  ]::text[],
  'authenticated has only audited organization and talent table mutation paths'
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
    'apply_billing_snapshot',
    'apply_resend_delivery_event',
    'apply_stripe_subscription_event',
    'authorize_integration_outbox_submission',
    'authorize_outbox_job_send_v2',
    'billing_provider_context',
    'claim_billing_reconciliation',
    'claim_integration_outbox_jobs',
    'claim_outbox_jobs',
    'complete_billing_checkout',
    'complete_integration_outbox_job',
    'complete_outbox_job_v2',
    'complete_subscription_checkout_intent',
    'consume_abuse_rate_limit',
    'consume_bot_token_once',
    'consume_public_registration_rate_limit',
    'consume_registration_confirmation_token',
    'create_decision_message_batch_v2',
    'decline_outbox_job_send_v2',
    'fail_integration_outbox_job',
    'fail_outbox_job_v2',
    'fail_subscription_checkout_intent',
    'finish_billing_reconciliation',
    'pending_account_deletion_notices',
    'public_registration_tryout_v2',
    'public_registration_tryout_v3',
    'public_registration_window',
    'purge_expired_communication_previews',
    'purge_expired_integration_previews',
    'purge_expired_subscription_checkout_intents',
    'queue_invitation_communication_v2',
    'queue_organizer_registration_notification',
    'queue_registration_confirmation_communication_v2',
    'read_organization_logo_service',
    'record_account_deletion_notice',
    'record_billing_delivery',
    'record_outbox_job_delivery_uncertain_v2',
    'reissue_registration_confirmation_token',
    'reserve_native_plan_replacement',
    'submit_public_registration_with_notification_v2',
    'upsert_organization_logo_service',
    'validate_integration_outbox_execution'
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
