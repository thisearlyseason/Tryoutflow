import { FEATURE_KEYS } from '../../../../src/modules/subscriptions/domain/feature-catalog';
import { ids, type FixtureState } from '../../../unit/ux/fictional-route-client';
export { ids };
export function createFictionalState(role = 'owner', variant = ''): FixtureState {
  const state: FixtureState = { tables: {}, rpcs: {}, tableErrors: {}, calls: [], user: null };
  state.user = { id: ids.user, email: 'fictional@example.test' };
  state.calls = [];
  state.tableErrors = {};
  state.tables = {
    organizations: [
      {
        id: ids.organization,
        name: 'Fictional Club',
        slug: 'fictional',
        timezone: 'UTC',
        terminology: {},
        sport_defaults: [],
        tag_defaults: [],
      },
    ],
    organization_members: [
      { organization_id: ids.organization, user_id: ids.user, role: 'owner', status: 'active' },
    ],
    tryouts: [
      {
        id: ids.tryout,
        organization_id: ids.organization,
        name: 'Fictional U14 Tryout',
        status: 'draft',
        sport: 'Basketball',
        timezone: 'UTC',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    athletes: [
      {
        id: ids.athlete,
        organization_id: ids.organization,
        given_name: 'Fictional',
        family_name: 'Athlete',
        birth_date: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  };
  state.rpcs = {
    can_use_talent: true,
    get_workspace_navigation: {
      isTeam: false,
      parent: null,
      workspaces: [
        { id: ids.organization, name: 'Fictional Club', slug: 'fictional', isTeam: false },
      ],
    },
    list_team_workspaces: [],
    list_organization_invitations: [],
    program_attendance: [],
    list_performance_exports: [],
    calibration_workspace: [],
    load_live_dashboard: [
      {
        result: {
          outcome: 'ok',
          dashboard: {
            registrations: 0,
            checkedIn: 0,
            activeEvaluators: 0,
            completedEvaluations: 0,
            expectedEvaluations: 0,
            recordedSyncExceptions: 0,
            generatedAt: '2026-01-01T00:00:00Z',
          },
        },
      },
    ],
    get_organization_logo_metadata: [],
    scouting_people: [],
    event_coverage: [],
    read_athlete_portrait: null,
    list_organization_evaluators: [],
    get_effective_entitlements: {
      organizationId: ids.organization,
      tryoutId: null,
      plan: 'organization',
      source: 'manual',
      features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])),
      limits: {
        active_tryouts: null,
        athletes_per_tryout: null,
        evaluators_per_tryout: null,
        custom_templates: null,
      },
      evaluatedAt: '2026-01-01T00:00:00Z',
      expiresAt: null,
    },
  };
  Object.assign(state.tables.tryouts![0]!, {
    version: 1,
    registration_starts_at: '2026-01-01T00:00:00Z',
    registration_ends_at: '2050-01-01T00:00:00Z',
  });
  state.tables.tryout_divisions = [
    {
      id: ids.division,
      organization_id: ids.organization,
      tryout_id: ids.tryout,
      name: 'Fictional U14',
      sort_order: 0,
    },
  ];
  state.tables.tryout_sessions = [
    {
      id: ids.session,
      organization_id: ids.organization,
      tryout_id: ids.tryout,
      division_id: ids.division,
      name: 'Fictional morning session',
      starts_at: '2049-01-01T10:00:00Z',
      ends_at: '2049-01-01T12:00:00Z',
      location: 'Fictional Court',
      capacity: 12,
      session_groups: [],
      tryout_divisions: { name: 'Fictional U14' },
    },
  ];
  state.rpcs.get_single_tryout_lifecycle = { single: false, sealed: false, locked: false };
  state.rpcs.get_tryout_setup_configuration = { divisions: [], sessions: [], positions: [] };
  state.rpcs.validate_tryout_for_publish = [
    'division_missing',
    'session_missing',
    'registration_form_missing',
    'rubric_invalid',
  ];
  state.rpcs.load_onboarding_facts = [
    {
      result: {
        outcome: 'ok',
        facts: {
          organizationExists: true,
          settingsConfigured: true,
          registrationConfigured: false,
          activeStaffCount: 0,
          publishedRubricCount: 0,
          sessionCount: 1,
          completedEvaluationCount: 0,
          finalizedRosterCount: 0,
        },
      },
    },
  ];
  state.rpcs.list_manageable_evaluator_assignments = [];
  state.rpcs.participant_workspace = [];
  state.rpcs.participant_offers = [];
  state.rpcs.list_organization_evaluators = [];
  state.rpcs.platform_health =
    role === 'platform'
      ? [
          {
            database_status: 'ok',
            failed_jobs: 0,
            webhook_failures: 0,
            communication_failures: 0,
            integration_failures: 0,
            synchronization_problems: 0,
          },
        ]
      : { __fixtureErrorCode: '42501' };
  for (const name of [
    'platform_list_organizations',
    'platform_list_subscriptions',
    'platform_list_audit_events',
    'platform_list_support_elevations',
    'platform_list_deletion_requests',
  ])
    state.rpcs[name] = [];
  if (role === 'anonymous') state.user = null;
  if (['member', 'evaluator', 'director', 'reviewer', 'checkin', 'scout'].includes(role))
    state.tables.organization_members![0]!.role = 'member';
  if (['evaluator', 'director', 'reviewer', 'checkin'].includes(role))
    state.tables.tryout_staff_assignments = [
      {
        organization_id: ids.organization,
        user_id: ids.user,
        role,
        scope_kind: 'tryout',
        tryout_id: ids.tryout,
        division_id: null,
        session_id: null,
        group_id: null,
        athlete_id: null,
        revoked_at: null,
        expires_at: null,
      },
    ];
  state.rpcs.can_use_talent = role === 'owner' || role === 'platform' || role === 'scout';
  const registration = '91000000-0000-4000-8000-000000000007';
  const rubric = '91000000-0000-4000-8000-000000000009';
  state.tables.session_rubrics = [
    {
      organization_id: ids.organization,
      tryout_id: ids.tryout,
      session_id: ids.session,
      rubric_version_id: rubric,
    },
  ];
  state.tables.rubric_categories = [
    {
      id: '91000000-0000-4000-8000-000000000010',
      organization_id: ids.organization,
      tryout_id: ids.tryout,
      rubric_version_id: rubric,
      name: 'Overall',
      description: 'Fictional criterion',
      guidance: 'Score only what you observe',
      scale_min: 1,
      scale_max: 5,
      weight: 100,
      sort_order: 0,
    },
  ];
  state.rpcs.list_assigned_athletes =
    role === 'evaluator'
      ? [
          {
            registration_id: registration,
            division_id: ids.division,
            session_id: ids.session,
            group_id: null,
            display_name: 'Fictional Assigned Athlete',
            division_name: 'Fictional U14',
            session_name: 'Fictional morning session',
            group_name: null,
            tryout_number: 12,
            identity_mode: 'full',
          },
        ]
      : [];
  state.rpcs.get_owned_subscription_account = [
    {
      organization_id: ids.organization,
      provider_customer_id: null,
      provider_subscription_id: null,
      provider_price_id: null,
      plan_key: null,
      state: 'inactive',
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: null,
      cancel_at: null,
      canceled_at: null,
      trial_end: null,
      verified_at: '2026-01-01T00:00:00Z',
      version: 1,
    },
  ];
  state.rpcs.load_report_summary = [
    {
      result: {
        outcome: 'ok',
        access: 'manager',
        summary: {
          athleteCount: 1,
          completedEvaluationCount: 0,
          incompleteEvaluationCount: 0,
          finalizedRosterCount: 0,
          latestFinalizedRosterId: null,
        },
      },
    },
  ];
  state.rpcs.load_ranking_snapshot = [
    {
      result: {
        outcome: 'ok',
        snapshot: {
          filterOptions: {
            divisions: [{ id: ids.division, name: 'Fictional U14' }],
            positions: [],
            sessions: [{ id: ids.session, name: 'Fictional morning session' }],
            groups: [],
          },
          registrations: [],
          generatedAt: '2026-01-01T00:00:00Z',
        },
      },
    },
  ];
  state.rpcs.validate_tryout_for_publish = [
    'division_missing',
    'session_missing',
    'registration_form_missing',
    'rubric_invalid',
  ].map((blocker) => ({ blocker }));
  state.rpcs.load_staff_registration_configuration = [
    {
      tryout_name: 'Fictional U14 Tryout',
      tryout_status: 'draft',
      divisions: [{ id: ids.division, name: 'Fictional U14' }],
      positions: [],
      form_schema: { fields: [] },
    },
  ];
  state.rpcs.platform_account_deletion_requests = [];
  Object.assign(state.tables.tryouts![0]!, { slug: 'fictional-public' });
  Object.assign(state.tables.organization_members![0]!, {
    id: '91000000-0000-4000-8000-000000000011',
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    inherited_from_organization_id: null,
  });
  state.rpcs.participant_schedule = [];
  state.rpcs.participant_registration_options = [];
  if (variant === 'finalized')
    state.tables.roster_versions = [
      {
        id: '91000000-0000-4000-8000-000000000008',
        organization_id: ids.organization,
        tryout_id: ids.tryout,
        division_id: ids.division,
        state: 'finalized',
        revision_number: 1,
        version: 1,
      },
    ];
  state.rpcs.list_tryout_evaluator_candidates = [];
  state.rpcs.public_registration_tryout_v3 = [
    {
      tryout_id: ids.tryout,
      name: 'Fictional public tryout',
      slug: 'fictional-public',
      form_version_id: '91000000-0000-4000-8000-000000000012',
      form_schema: { fields: [] },
      divisions: [{ id: ids.division, name: 'Fictional U14' }],
      positions: [],
      organization_name: 'Fictional Club',
      organization_slug: 'fictional',
      logo_exists: false,
    },
  ];
  state.rpcs.get_billing_dashboard = {
    access: state.rpcs.get_effective_entitlements,
    purchasesEnabled: false,
    trial: { eligible: false, startsAt: null, expiresAt: null },
    subscriptions: [],
    overrides: [],
    history: [],
    usage: { active_tryouts: 1 },
  };
  return state;
}
