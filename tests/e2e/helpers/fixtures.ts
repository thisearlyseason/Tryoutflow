import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { test as base, expect, type APIRequestContext, type TestInfo } from '@playwright/test';
import { z } from 'zod';

import {
  task30BrowserAddress,
  task30PublicRequestRateKeys,
  task30RegistrationRateKeys,
  type Task30PublicRateBucket,
} from './environment';

const localSupabaseSchema = z.strictObject({
  API_URL: z.url(),
  DB_URL: z.string().startsWith('postgresql://'),
  SERVICE_ROLE_KEY: z.string().min(1),
});
const adminUserSchema = z.object({ id: z.uuid() }).passthrough();

export type BrowserUser = Readonly<{
  id: string;
  email: string;
  password: string;
  role: string;
}>;

export type ScenarioIds = Readonly<{
  organization: string;
  otherOrganization: string;
  tryout: string;
  division: string;
  rosterDivision: string;
  finalDivision: string;
  session: string;
  form: string;
  formVersion: string;
  rubric: string;
  rubricVersion: string;
  categoryControl: string;
  categoryFinish: string;
  position: string;
  athleteA: string;
  athleteB: string;
  athleteC: string;
  athleteD: string;
  returningAthlete: string;
  rosterAthleteA: string;
  rosterAthleteB: string;
  finalAthleteA: string;
  finalAthleteB: string;
  registrationA: string;
  registrationB: string;
  registrationC: string;
  registrationD: string;
  rosterRegistrationA: string;
  rosterRegistrationB: string;
  finalRegistrationA: string;
  finalRegistrationB: string;
  draftRoster: string;
  finalRoster: string;
  draftTeamBlue: string;
  draftTeamGold: string;
  finalTeam: string;
}>;

export type Task30Scenario = Readonly<{
  key: string;
  publicClientAddress: string;
  organizationName: string;
  organizationSlug: string;
  otherOrganizationSlug: string;
  tryoutName: string;
  ids: ScenarioIds;
  users: Readonly<{
    owner: BrowserUser;
    administrator: BrowserUser;
    director: BrowserUser;
    evaluatorOne: BrowserUser;
    evaluatorTwo: BrowserUser;
    evaluatorThree: BrowserUser;
    checkin: BrowserUser;
    reviewer: BrowserUser;
    member: BrowserUser;
    otherOwner: BrowserUser;
    platformAdministrator: BrowserUser;
  }>;
  database: Readonly<{
    execute(sql: string): void;
    scalar(sql: string): string;
    trackPublicRateTarget(bucket: Task30PublicRateBucket, target: string): void;
  }>;
}>;

type Task30Fixtures = {
  newOwner: BrowserUser;
  scenario: Task30Scenario;
  task30Database: Readonly<{
    scalar(sql: string): string;
  }>;
};

function stableUuid(seed: string) {
  const bytes = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  bytes[12] = '4';
  bytes[16] = ['8', '9', 'a', 'b'][Number.parseInt(bytes[16]!, 16) % 4]!;
  const value = bytes.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function stableKey(testInfo: TestInfo) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        testInfo.project.name,
        testInfo.titlePath,
        testInfo.repeatEachIndex,
        testInfo.retry,
      ]),
    )
    .digest('hex')
    .slice(0, 12);
  return `t30-${digest}`;
}

function localSupabase() {
  const raw = z.record(z.string(), z.unknown()).parse(
    JSON.parse(
      execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {
        encoding: 'utf8',
      }),
    ) as unknown,
  );
  return localSupabaseSchema.parse({
    API_URL: raw.API_URL,
    DB_URL: raw.DB_URL,
    SERVICE_ROLE_KEY: raw.SECRET_KEY ?? raw.SERVICE_ROLE_KEY,
  });
}

function executeSql(databaseUrl: string, sql: string) {
  execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl], {
    input: sql,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function cleanupPublicRegistrationRateKeys(databaseUrl: string, rateKeys: ReadonlySet<string>) {
  const keys = [...rateKeys].map((value) => `'${value}'`).join(',');
  executeSql(
    databaseUrl,
    `delete from public.registration_rate_counters where key_hash in(${keys});`,
  );
}

function scalarSql(databaseUrl: string, sql: string) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commaSeparated(value: string) {
  return value.split(',').filter(Boolean);
}

async function createBrowserUser(
  request: APIRequestContext,
  local: z.infer<typeof localSupabaseSchema>,
  key: string,
  role: string,
) {
  const email = `${key}-${role}@example.test`;
  const password = `Task30-${createHash('sha256').update(email).digest('hex').slice(0, 18)}!Aa`;
  const created = await request.post(`${local.API_URL}/auth/v1/admin/users`, {
    headers: {
      apikey: local.SERVICE_ROLE_KEY,
      authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
    },
    data: { email, password, email_confirm: true },
  });
  expect(created.ok(), `GoTrue user creation failed for ${role}: ${await created.text()}`).toBe(
    true,
  );
  const parsed = adminUserSchema.parse(await created.json());
  return { id: parsed.id, email, password, role } satisfies BrowserUser;
}

function cleanupSql(organizationIds: readonly string[], userIds: readonly string[]) {
  const organizations = organizationIds.map((id) => `'${id}'::uuid`).join(',');
  const users = userIds.map((id) => `'${id}'::uuid`).join(',');
  return `begin;
    set local session_replication_role=replica;
    select pg_advisory_xact_lock(7461736,30);
    alter table private.roster_report_snapshot_items disable trigger prevent_roster_report_snapshot_item_update_delete;
    alter table private.roster_report_snapshots disable trigger prevent_roster_report_snapshot_update_delete;
    alter table public.analytics_outbox_events disable trigger prevent_analytics_outbox_mutation;
    alter table public.decision_history disable trigger prevent_decision_history_delete;
    alter table public.communication_batches disable trigger prevent_communication_batches_mutation;
    alter table public.communication_delivery_events disable trigger prevent_communication_delivery_events_mutation;
    alter table public.communication_pending_delivery_events disable trigger prevent_pending_delivery_events_mutation;
    alter table public.communication_preview_tombstones disable trigger prevent_communication_preview_tombstones_mutation;
    alter table public.roster_assignments disable trigger guard_roster_assignments_snapshot;
    alter table public.roster_decisions disable trigger guard_roster_decisions_snapshot;
    alter table public.roster_versions disable trigger prevent_finalized_roster_version_mutation;
    alter table public.tryout_teams disable trigger prevent_finalized_roster_team_mutation;
    delete from private.roster_report_snapshot_items where organization_id=any(array[${organizations}]::uuid[]);
    delete from private.roster_report_snapshots where organization_id=any(array[${organizations}]::uuid[]);
    alter table private.roster_report_snapshot_items enable always trigger prevent_roster_report_snapshot_item_update_delete;
    alter table private.roster_report_snapshots enable always trigger prevent_roster_report_snapshot_update_delete;
    do $cleanup$ declare target record; begin
      for target in
        select c.table_schema,c.table_name
        from information_schema.columns c
        join information_schema.tables t using(table_schema,table_name)
        where c.table_schema in('private','public') and c.column_name='organization_id'
          and c.table_name<>'organizations' and t.table_type='BASE TABLE'
          and c.table_name not in('roster_report_snapshots','roster_report_snapshot_items')
        order by c.table_schema,c.table_name
      loop
        execute format('delete from %I.%I where organization_id=any($1)',target.table_schema,target.table_name)
          using array[${organizations}]::uuid[];
      end loop;
    end $cleanup$;
    alter table public.decision_history enable always trigger prevent_decision_history_delete;
    alter table public.communication_batches enable always trigger prevent_communication_batches_mutation;
    alter table public.communication_delivery_events enable always trigger prevent_communication_delivery_events_mutation;
    alter table public.communication_pending_delivery_events enable always trigger prevent_pending_delivery_events_mutation;
    alter table public.communication_preview_tombstones enable always trigger prevent_communication_preview_tombstones_mutation;
    alter table public.analytics_outbox_events enable always trigger prevent_analytics_outbox_mutation;
    alter table public.roster_assignments enable always trigger guard_roster_assignments_snapshot;
    alter table public.roster_decisions enable always trigger guard_roster_decisions_snapshot;
    alter table public.roster_versions enable always trigger prevent_finalized_roster_version_mutation;
    alter table public.tryout_teams enable always trigger prevent_finalized_roster_team_mutation;
    delete from public.organizations where id=any(array[${organizations}]::uuid[]);
    delete from public.platform_administrators where user_id=any(array[${users}]::uuid[]);
    delete from public.profiles where id=any(array[${users}]::uuid[]);
    delete from private.abuse_rate_limits;
    delete from private.bot_token_receipts;
    set local session_replication_role=origin;
    delete from auth.users where id=any(array[${users}]::uuid[]);
    commit;`;
}

export function cleanupTask30Residue() {
  const local = localSupabase();
  const userIds = commaSeparated(
    scalarSql(
      local.DB_URL,
      `select coalesce(string_agg(id::text,','),'') from auth.users where email like 't30-%@example.test'`,
    ),
  );
  const organizationIds = commaSeparated(
    scalarSql(
      local.DB_URL,
      `select coalesce(string_agg(id::text,','),'') from public.organizations where slug like 't30-%' or slug like 'task30-onboarding-%'`,
    ),
  );
  if (organizationIds.length > 0 || userIds.length > 0)
    executeSql(local.DB_URL, cleanupSql(organizationIds, userIds));
  executeSql(
    local.DB_URL,
    'delete from private.abuse_rate_limits; delete from private.bot_token_receipts;',
  );
}

function idsFor(key: string): ScenarioIds {
  const id = (name: string) => stableUuid(`${key}:${name}`);
  return {
    organization: id('organization'),
    otherOrganization: id('other-organization'),
    tryout: id('tryout'),
    division: id('division'),
    rosterDivision: id('roster-division'),
    finalDivision: id('final-division'),
    session: id('session'),
    form: id('form'),
    formVersion: id('form-version'),
    rubric: id('rubric'),
    rubricVersion: id('rubric-version'),
    categoryControl: id('category-control'),
    categoryFinish: id('category-finish'),
    position: id('position'),
    athleteA: id('athlete-a'),
    athleteB: id('athlete-b'),
    athleteC: id('athlete-c'),
    athleteD: id('athlete-d'),
    returningAthlete: id('returning-athlete'),
    rosterAthleteA: id('roster-athlete-a'),
    rosterAthleteB: id('roster-athlete-b'),
    finalAthleteA: id('final-athlete-a'),
    finalAthleteB: id('final-athlete-b'),
    registrationA: id('registration-a'),
    registrationB: id('registration-b'),
    registrationC: id('registration-c'),
    registrationD: id('registration-d'),
    rosterRegistrationA: id('roster-registration-a'),
    rosterRegistrationB: id('roster-registration-b'),
    finalRegistrationA: id('final-registration-a'),
    finalRegistrationB: id('final-registration-b'),
    draftRoster: id('draft-roster'),
    finalRoster: id('final-roster'),
    draftTeamBlue: id('draft-team-blue'),
    draftTeamGold: id('draft-team-gold'),
    finalTeam: id('final-team'),
  };
}

function seedScenarioSql(
  key: string,
  ids: ScenarioIds,
  users: Task30Scenario['users'],
  organizationName: string,
  organizationSlug: string,
  otherOrganizationSlug: string,
  tryoutName: string,
) {
  const member = (user: BrowserUser, role: 'owner' | 'administrator' | 'member') =>
    `('${stableUuid(`${key}:member:${user.role}`)}','${ids.organization}','${user.id}','${role}','active')`;
  const assignment = (user: BrowserUser, role: 'director' | 'evaluator' | 'checkin' | 'reviewer') =>
    `('${stableUuid(`${key}:assignment:${user.role}`)}','${ids.organization}','${user.id}','${role}','tryout','${ids.tryout}','${users.owner.id}')`;
  const athleteRows = [
    [ids.athleteA, 'Exact', 'Aggregate'],
    [ids.athleteB, 'Tie', 'Alpha'],
    [ids.athleteC, 'Tie', 'Beta'],
    [ids.athleteD, 'Offline', 'Rinkside'],
    [ids.returningAthlete, 'Returning', 'Prospect'],
    [ids.rosterAthleteA, 'Roster', 'Mover'],
    [ids.rosterAthleteB, 'Roster', 'Keeper'],
    [ids.finalAthleteA, 'Final', 'Selected'],
    [ids.finalAthleteB, 'Final', 'Released'],
  ]
    .map(
      ([id, given, family], index) =>
        `('${id}','${ids.organization}','${given}','${family}','${given!.toLowerCase()}','${family!.toLowerCase()}','2012-${String(index + 1).padStart(2, '0')}-01')`,
    )
    .join(',');
  const registrationRows = [
    [ids.registrationA, ids.athleteA, ids.division, 'a'],
    [ids.registrationB, ids.athleteB, ids.division, 'b'],
    [ids.registrationC, ids.athleteC, ids.division, 'c'],
    [ids.registrationD, ids.athleteD, ids.division, 'd'],
    [ids.rosterRegistrationA, ids.rosterAthleteA, ids.rosterDivision, 'e'],
    [ids.rosterRegistrationB, ids.rosterAthleteB, ids.rosterDivision, 'f'],
    [ids.finalRegistrationA, ids.finalAthleteA, ids.finalDivision, '1'],
    [ids.finalRegistrationB, ids.finalAthleteB, ids.finalDivision, '2'],
  ]
    .map(
      ([id, athlete, division, digest]) =>
        `('${id}','${ids.organization}','${ids.tryout}','${athlete}','${division}','${ids.position}','${ids.formVersion}','{"consent":true}','staff','submitted',repeat('${digest}',64),repeat('${digest}',64),2)`,
    )
    .join(',');
  const enrollmentRows = [
    ids.registrationA,
    ids.registrationB,
    ids.registrationC,
    ids.registrationD,
  ]
    .map(
      (registration, index) =>
        `('${stableUuid(`${key}:enrollment:${index}`)}','${ids.organization}','${ids.tryout}','${registration}','${ids.session}')`,
    )
    .join(',');
  return `begin;
    insert into public.organizations(id,name,slug,timezone,sport_defaults)
      values('${ids.organization}','${organizationName}','${organizationSlug}','America/Edmonton','["Hockey"]'),
            ('${ids.otherOrganization}','Task 30 Other Tenant ${key}','${otherOrganizationSlug}','America/Toronto','["Hockey"]');
    insert into public.organization_members(id,organization_id,user_id,role,status) values
      ${member(users.owner, 'owner')},
      ${member(users.administrator, 'administrator')},
      ${member(users.director, 'member')},
      ${member(users.evaluatorOne, 'member')},
      ${member(users.evaluatorTwo, 'member')},
      ${member(users.evaluatorThree, 'member')},
      ${member(users.checkin, 'member')},
      ${member(users.reviewer, 'member')},
      ${member(users.member, 'member')},
      ('${stableUuid(`${key}:member:other-owner`)}','${ids.otherOrganization}','${users.otherOwner.id}','owner','active');
    insert into public.platform_administrators(user_id,granted_by_user_id)
      values('${users.platformAdministrator.id}','${users.owner.id}');
    insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at,starts_at,ends_at)
      values('${ids.tryout}','${ids.organization}','${tryoutName}','${organizationSlug}-critical-flow','Hockey','America/Edmonton',
        '2026-08-01T00:00:00Z','2026-09-30T23:59:59Z','2026-09-15T16:00:00Z','2026-09-16T22:00:00Z');
    insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
      ('${ids.division}','${ids.organization}','${ids.tryout}','U15 Scoring',0),
      ('${ids.rosterDivision}','${ids.organization}','${ids.tryout}','U16 Roster',1),
      ('${ids.finalDivision}','${ids.organization}','${ids.tryout}','U17 Final',2);
    insert into public.tryout_positions(id,organization_id,tryout_id,name,code,is_preset,sort_order)
      values('${ids.position}','${ids.organization}','${ids.tryout}','Forward','F',true,0);
    insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,location,starts_at,ends_at,sort_order)
      values('${ids.session}','${ids.organization}','${ids.tryout}','${ids.division}','Task 30 Exact Scoring','Contract Rink',
        '2026-09-15T16:00:00Z','2026-09-15T18:00:00Z',0);
    insert into public.registration_forms(id,organization_id,tryout_id,name)
      values('${ids.form}','${ids.organization}','${ids.tryout}','Task 30 public registration');
    insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
      values('${ids.formVersion}','${ids.organization}','${ids.tryout}','${ids.form}',1,
        '{"fields":[{"key":"consent","label":"I consent","kind":"consent","required":true,"sortOrder":0}]}',
        'published',clock_timestamp());
    insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
      values('${ids.organization}','${ids.tryout}','${ids.formVersion}');
    insert into public.rubrics(id,organization_id,tryout_id,name)
      values('${ids.rubric}','${ids.organization}','${ids.tryout}','Task 30 exact rubric');
    insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number,status,published_at)
      values('${ids.rubricVersion}','${ids.organization}','${ids.tryout}','${ids.rubric}',1,'draft',null);
    insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max,is_priority) values
      ('${ids.categoryControl}','${ids.organization}','${ids.tryout}','${ids.rubricVersion}','Control',0,20,1,10,true),
      ('${ids.categoryFinish}','${ids.organization}','${ids.tryout}','${ids.rubricVersion}','Finish',1,80,1,10,true);
    insert into public.session_rubrics(id,organization_id,tryout_id,session_id,rubric_version_id)
      values('${stableUuid(`${key}:session-rubric`)}','${ids.organization}','${ids.tryout}','${ids.session}','${ids.rubricVersion}');
    update public.rubric_versions set status='published',published_at=clock_timestamp() where id='${ids.rubricVersion}';
    insert into public.tryout_staff_assignments(id,organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id) values
      ${assignment(users.director, 'director')},
      ${assignment(users.evaluatorOne, 'evaluator')},
      ${assignment(users.evaluatorTwo, 'evaluator')},
      ${assignment(users.evaluatorThree, 'evaluator')},
      ${assignment(users.checkin, 'checkin')},
      ${assignment(users.reviewer, 'reviewer')};
    insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
      values ${athleteRows};
    insert into public.guardians(id,organization_id,name,email,normalized_email) values
      ('${stableUuid(`${key}:guardian-final-a`)}','${ids.organization}','Synthetic Guardian A','selected-${key}@example.test','selected-${key}@example.test'),
      ('${stableUuid(`${key}:guardian-final-b`)}','${ids.organization}','Synthetic Guardian B','released-${key}@example.test','released-${key}@example.test');
    insert into public.athlete_guardians(organization_id,athlete_id,guardian_id,is_primary_contact) values
      ('${ids.organization}','${ids.finalAthleteA}','${stableUuid(`${key}:guardian-final-a`)}',true),
      ('${ids.organization}','${ids.finalAthleteB}','${stableUuid(`${key}:guardian-final-b`)}',true);
    insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,position_id,registration_form_version_id,responses,source,status,submission_key_digest,submission_digest,submission_digest_version)
      values ${registrationRows};
    insert into public.session_enrollments(id,organization_id,tryout_id,registration_id,session_id)
      values ${enrollmentRows};
    insert into public.tryout_numbers(id,organization_id,tryout_id,registration_id,division_id,scope_kind,number,assigned_by_user_id)
      select gen_random_uuid(),'${ids.organization}','${ids.tryout}',registration_id,'${ids.division}','division',number,'${users.director.id}'
      from (values('${ids.registrationA}'::uuid,41),('${ids.registrationB}'::uuid,42),('${ids.registrationC}'::uuid,43),('${ids.registrationD}'::uuid,44)) valueset(registration_id,number);
    set local session_replication_role=replica;
    update public.tryouts set status='published',published_at=clock_timestamp() where id='${ids.tryout}';
    set local session_replication_role=origin;
    select private.permit_evaluation_write('${stableUuid(`${key}:tie-evaluation-a`)}','save');
    insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version)
      values('${stableUuid(`${key}:tie-evaluation-a`)}','${ids.organization}','${ids.tryout}','${ids.division}','${ids.registrationB}','${ids.session}','${users.evaluatorOne.id}','${ids.rubricVersion}','draft',1);
    insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value) values
      ('${stableUuid(`${key}:tie-score-a1`)}','${ids.organization}','${ids.tryout}','${stableUuid(`${key}:tie-evaluation-a`)}','${ids.rubricVersion}','${ids.categoryControl}',2),
      ('${stableUuid(`${key}:tie-score-a2`)}','${ids.organization}','${ids.tryout}','${stableUuid(`${key}:tie-evaluation-a`)}','${ids.rubricVersion}','${ids.categoryFinish}',10);
    select private.permit_evaluation_write('${stableUuid(`${key}:tie-evaluation-a`)}','complete');
    update public.evaluations set state='completed',version=2,completed_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 microsecond' where id='${stableUuid(`${key}:tie-evaluation-a`)}';
    delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='${stableUuid(`${key}:tie-evaluation-a`)}';
    select private.permit_evaluation_write('${stableUuid(`${key}:tie-evaluation-b`)}','save');
    insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,version)
      values('${stableUuid(`${key}:tie-evaluation-b`)}','${ids.organization}','${ids.tryout}','${ids.division}','${ids.registrationC}','${ids.session}','${users.evaluatorTwo.id}','${ids.rubricVersion}','draft',1);
    insert into public.evaluation_scores(id,organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value) values
      ('${stableUuid(`${key}:tie-score-b1`)}','${ids.organization}','${ids.tryout}','${stableUuid(`${key}:tie-evaluation-b`)}','${ids.rubricVersion}','${ids.categoryControl}',2),
      ('${stableUuid(`${key}:tie-score-b2`)}','${ids.organization}','${ids.tryout}','${stableUuid(`${key}:tie-evaluation-b`)}','${ids.rubricVersion}','${ids.categoryFinish}',10);
    select private.permit_evaluation_write('${stableUuid(`${key}:tie-evaluation-b`)}','complete');
    update public.evaluations set state='completed',version=2,completed_at=clock_timestamp(),updated_at=clock_timestamp()+interval '1 microsecond' where id='${stableUuid(`${key}:tie-evaluation-b`)}';
    delete from private.evaluation_write_permits where transaction_id=txid_current() and evaluation_id='${stableUuid(`${key}:tie-evaluation-b`)}';
    insert into public.tryout_teams(id,organization_id,tryout_id,division_id,name,sort_order,target_size) values
      ('${ids.draftTeamBlue}','${ids.organization}','${ids.tryout}','${ids.rosterDivision}','Critical Blue',0,2),
      ('${ids.draftTeamGold}','${ids.organization}','${ids.tryout}','${ids.rosterDivision}','Critical Gold',1,2),
      ('${ids.finalTeam}','${ids.organization}','${ids.tryout}','${ids.finalDivision}','Final Blue',0,2);
    insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,created_by_user_id) values
      ('${ids.draftRoster}','${ids.organization}','${ids.tryout}','${ids.rosterDivision}',1,'draft',1,'${users.director.id}'),
      ('${ids.finalRoster}','${ids.organization}','${ids.tryout}','${ids.finalDivision}',1,'draft',1,'${users.director.id}');
    insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at) values
      ('${ids.organization}','${ids.tryout}','${ids.rosterDivision}','${ids.draftRoster}','${ids.rosterRegistrationA}','undecided',null,null),
      ('${ids.organization}','${ids.tryout}','${ids.rosterDivision}','${ids.draftRoster}','${ids.rosterRegistrationB}','selected','${users.director.id}',clock_timestamp()),
      ('${ids.organization}','${ids.tryout}','${ids.finalDivision}','${ids.finalRoster}','${ids.finalRegistrationA}','selected','${users.director.id}',clock_timestamp()),
      ('${ids.organization}','${ids.tryout}','${ids.finalDivision}','${ids.finalRoster}','${ids.finalRegistrationB}','released','${users.director.id}',clock_timestamp());
    insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id) values
      ('${ids.organization}','${ids.tryout}','${ids.rosterDivision}','${ids.draftRoster}','${ids.rosterRegistrationB}','${ids.draftTeamBlue}','${users.director.id}'),
      ('${ids.organization}','${ids.tryout}','${ids.finalDivision}','${ids.finalRoster}','${ids.finalRegistrationA}','${ids.finalTeam}','${users.director.id}'),
      ('${ids.organization}','${ids.tryout}','${ids.finalDivision}','${ids.finalRoster}','${ids.finalRegistrationB}','${ids.finalTeam}','${users.director.id}');
    set local role authenticated;
    set local request.jwt.claim.sub='${users.director.id}';
    select outcome from public.finalize_roster_version('${ids.organization}','${ids.tryout}','${ids.finalDivision}','${ids.finalRoster}',1,'FINALIZE ROSTER');
    reset role;
    commit;`;
}

export const test = base.extend<Task30Fixtures>({
  task30Database: async ({}, use) => {
    const local = localSupabase();
    await use({ scalar: (sql) => scalarSql(local.DB_URL, sql) });
  },
  newOwner: async ({ request }, use, testInfo) => {
    const local = localSupabase();
    const key = `${stableKey(testInfo)}-new-owner`;
    const user = await createBrowserUser(request, local, key, 'owner');
    await use(user);
  },
  scenario: async ({ request }, use, testInfo) => {
    const local = localSupabase();
    const key = stableKey(testInfo);
    const ids = idsFor(key);
    const roles = [
      'owner',
      'administrator',
      'director',
      'evaluator-one',
      'evaluator-two',
      'evaluator-three',
      'checkin',
      'reviewer',
      'member',
      'other-owner',
      'platform-administrator',
    ] as const;
    const created = await Promise.all(
      roles.map((role) => createBrowserUser(request, local, key, role)),
    );
    const users = {
      owner: created[0]!,
      administrator: created[1]!,
      director: created[2]!,
      evaluatorOne: created[3]!,
      evaluatorTwo: created[4]!,
      evaluatorThree: created[5]!,
      checkin: created[6]!,
      reviewer: created[7]!,
      member: created[8]!,
      otherOwner: created[9]!,
      platformAdministrator: created[10]!,
    } as const;
    const organizationName = `Task 30 ${key} Hockey`;
    const organizationSlug = `${key}-hockey`;
    const otherOrganizationSlug = `${key}-other`;
    const tryoutName = `Task 30 ${key} Critical Tryout`;
    const publicTryoutSlug = `${organizationSlug}-critical-flow`;
    const publicRateKeys = new Set(task30RegistrationRateKeys(key, publicTryoutSlug));
    cleanupPublicRegistrationRateKeys(local.DB_URL, publicRateKeys);
    try {
      executeSql(
        local.DB_URL,
        seedScenarioSql(
          key,
          ids,
          users,
          organizationName,
          organizationSlug,
          otherOrganizationSlug,
          tryoutName,
        ),
      );
      await use({
        key,
        publicClientAddress: task30BrowserAddress(key),
        organizationName,
        organizationSlug,
        otherOrganizationSlug,
        tryoutName,
        ids,
        users,
        database: {
          execute: (sql) => executeSql(local.DB_URL, sql),
          scalar: (sql) => scalarSql(local.DB_URL, sql),
          trackPublicRateTarget(bucket, target) {
            for (const rateKey of task30PublicRequestRateKeys(key, bucket, target)) {
              publicRateKeys.add(rateKey);
            }
          },
        },
      });
    } finally {
      cleanupPublicRegistrationRateKeys(local.DB_URL, publicRateKeys);
    }
  },
});

export { expect } from '@playwright/test';
