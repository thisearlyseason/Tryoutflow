-- Final named-role ACL closure. Supabase seeds named API-role default grants, so
-- revoking PUBLIC alone is insufficient. Sweep the complete application
-- catalog, then regrant only audited production call sites.

create or replace function private.deny_security_critical_truncate()
returns trigger language plpgsql set search_path='' as $$
begin
  raise object_not_in_prerequisite_state using message='security-critical evidence cannot be truncated';
end;
$$;

create trigger deny_organizations_truncate before truncate on public.organizations
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_organization_members_truncate before truncate on public.organization_members
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_organization_invitations_truncate before truncate on public.organization_invitations
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_audit_logs_truncate before truncate on public.audit_logs
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_registration_forms_truncate before truncate on public.registration_forms
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_registration_form_versions_truncate before truncate on public.registration_form_versions
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_rubrics_truncate before truncate on public.rubrics
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_rubric_versions_truncate before truncate on public.rubric_versions
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_rubric_categories_truncate before truncate on public.rubric_categories
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_abuse_rate_limits_truncate before truncate on private.abuse_rate_limits
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_bot_token_receipts_truncate before truncate on private.bot_token_receipts
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_membership_receipts_truncate before truncate on private.membership_command_receipts
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_analytics_outbox_truncate before truncate on public.analytics_outbox_events
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_platform_administrators_truncate before truncate on public.platform_administrators
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_platform_support_elevations_truncate before truncate on public.platform_support_elevations
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_tryout_publications_truncate before truncate on public.tryout_publications
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_registration_form_selections_truncate before truncate on public.tryout_registration_form_selections
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_confirmation_tokens_truncate before truncate on public.registration_confirmation_tokens
  for each statement execute function private.deny_security_critical_truncate();
create trigger deny_checkin_qr_tokens_truncate before truncate on public.checkin_qr_tokens
  for each statement execute function private.deny_security_critical_truncate();

do $$
declare item record;
begin
  for item in
    select relation.oid::regclass as identity
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in('public','private') and relation.relkind in('r','p','v','m','f')
  loop
    execute format('alter table %s enable row level security',item.identity);
    execute format('revoke all privileges on table %s from public, anon, authenticated, service_role',item.identity);
  end loop;
  for item in
    select relation.oid::regclass as identity
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname in('public','private') and relation.relkind='S'
  loop
    execute format('revoke all privileges on sequence %s from public, anon, authenticated, service_role',item.identity);
  end loop;
  for item in
    select routine.oid::regprocedure as identity
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname in('public','private') and routine.prokind='f'
  loop
    execute format('alter function %s set search_path=''''',item.identity);
    execute format('revoke all privileges on function %s from public, anon, authenticated, service_role',item.identity);
  end loop;
end;
$$;

revoke all on schema public,private from public,anon,authenticated,service_role;
grant usage on schema public to anon,authenticated,service_role;

alter default privileges for role postgres in schema public revoke all privileges on tables from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all privileges on sequences from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all privileges on functions from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema private revoke all privileges on tables from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema private revoke all privileges on sequences from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema private revoke all privileges on functions from public,anon,authenticated,service_role;
grant select on table
  public.athlete_flags,
  public.athlete_guardians,
  public.athlete_import_previews,
  public.athletes,
  public.audit_logs,
  public.communication_messages,
  public.decision_history,
  public.evaluation_note_tags,
  public.evaluation_notes,
  public.evaluation_scores,
  public.evaluations,
  public.external_entity_mappings,
  public.guardians,
  public.integration_connections,
  public.integration_sync_items,
  public.integration_sync_jobs,
  public.organization_evaluation_note_tags,
  public.organization_members,
  public.organizations,
  public.profiles,
  public.registration_duplicate_candidates,
  public.registration_form_versions,
  public.registration_forms,
  public.roster_assignments,
  public.roster_decisions,
  public.roster_versions,
  public.rubrics,
  public.rubric_categories,
  public.rubric_versions,
  public.seasons,
  public.session_enrollments,
  public.session_groups,
  public.session_rubrics,
  public.subscription_accounts,
  public.tryout_divisions,
  public.tryout_positions,
  public.tryout_registrations,
  public.tryout_sessions,
  public.tryout_setup_progress,
  public.tryout_staff_assignments,
  public.tryout_teams,
  public.tryouts
to authenticated;
grant update on table public.organizations to authenticated;

do $$
declare item record;
begin
  for item in
    select routine.oid::regprocedure as identity
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname='public' and routine.proname=any(array[
      'accept_organization_invitation','assign_evaluator','assign_tryout_number',
      'begin_support_elevation','change_organization_member','change_roster_decisions',
      'check_in_registration','check_in_registration_v2','commit_athlete_import','complete_evaluation',
      'configure_evaluation_note_tag','confirm_roster_export_preview_v4',
      'create_athlete_import_preview','create_decision_message_batch_v2',
      'create_organization_invitation','create_organization_with_owner',
      'create_registration_form_revision','create_roster_draft','create_rubric_revision',
      'create_staff_registration','create_tryout_draft','create_tryout_draft_with_cycle',
      'enqueue_analytics_event','finalize_roster_version','get_owned_subscription_account',
      'issue_checkin_qr_token','issue_roster_export_source','list_assigned_athletes',
      'list_communication_templates_for_notice','list_manageable_evaluator_assignments',
      'list_organization_evaluators','list_returning_athletes','list_tryout_evaluator_candidates',
      'load_staff_registration_configuration',
      'load_live_dashboard','load_onboarding_facts','load_ranking_snapshot','load_report_export',
      'load_report_summary','load_roster_workspace','lock_evaluation',
      'manage_director_evaluation_flag','move_roster_athlete','platform_health',
      'platform_list_audit_events','platform_list_organizations','platform_list_subscriptions',
      'platform_list_support_elevations','preview_decision_message_batch_v2','public_health_check',
      'publish_registration_form_version','publish_rubric_version','publish_tryout',
      'queue_invitation_communication_v2','queue_registration_communication_v2',
      'queue_roster_decision_communication_v2',
      'release_tryout_number','reopen_evaluation','reserve_subscription_checkout_intent',
      'resolve_athlete_import_duplicate','resolve_registration_duplicate',
      'retry_integration_sync_job_v4','revise_roster_version','revoke_evaluator_assignment',
      'save_communication_template','save_evaluation_draft','save_integration_connection',
      'save_roster_export_preview_v2','save_tryout_setup_step','save_tryout_wizard_configuration',
      'search_checkin_registrations_v2','select_tryout_registration_form_version',
      'sync_evaluation_mutation','transfer_organization_ownership','transition_tryout_lifecycle',
      'validate_tryout_for_publish','can_access_evaluation','purge_expired_athlete_import_previews',
      'search_checkin_registrations',
      -- RLS policy entry points.
      'can_manage_session_group','can_manage_tryout_division','can_manage_tryout_root',
      'can_manage_tryout_session','can_read_full_athlete_pii','can_read_full_registration_pii',
      'can_read_tenant_record','can_read_tryout_configuration','can_select_director_flag',
      'can_select_own_evaluation','has_active_configuration_assignment',
      'is_active_organization_member'
    ])
  loop execute format('grant execute on function %s to authenticated',item.identity); end loop;
end;
$$;
grant execute on function private.can_read_roster(uuid,uuid,uuid,boolean) to authenticated;

do $$
declare item record;
begin
  for item in
    select routine.oid::regprocedure as identity
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname='public' and routine.proname=any(array[
      'apply_resend_delivery_event','apply_stripe_subscription_event',
      'authorize_integration_outbox_submission','authorize_outbox_job_send_v2',
      'claim_integration_outbox_jobs','claim_outbox_jobs','complete_integration_outbox_job',
      'complete_outbox_job_v2','complete_subscription_checkout_intent',
      'consume_abuse_rate_limit','consume_bot_token_once','consume_public_registration_rate_limit',
      'consume_registration_confirmation_token','decline_outbox_job_send_v2',
      'fail_integration_outbox_job','fail_outbox_job_v2','fail_subscription_checkout_intent',
      'create_decision_message_batch_v2','public_registration_tryout_v2','purge_expired_communication_previews',
      'purge_expired_integration_previews','purge_expired_subscription_checkout_intents',
      'queue_invitation_communication_v2','queue_registration_confirmation_communication_v2',
      'record_outbox_job_delivery_uncertain_v2',
      'reissue_registration_confirmation_token','submit_public_registration_v2',
      'validate_integration_outbox_execution'
    ])
  loop execute format('grant execute on function %s to service_role',item.identity); end loop;
end;
$$;

grant execute on function public.public_health_check() to anon;

-- This fully-qualified, invoker-only SQL helper is the single deliberate
-- exception: a SET clause prevents PostgreSQL from inlining it and breaks the
-- proven bounded report plan. It has no API-role EXECUTE grant or schema usage.
alter function private.explainable_report_athlete_candidates(uuid,uuid,integer) reset search_path;
