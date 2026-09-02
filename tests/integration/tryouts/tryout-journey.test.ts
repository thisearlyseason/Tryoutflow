// @vitest-environment node

import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../../../src/infrastructure/supabase/database.types';
import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { loadTryoutJourney } from '../../../src/modules/tryouts/application/load-tryout-journey';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);

let apiUrl = '';
let publishableKey = '';
let serviceKey = '';

beforeAll(() => {
  const config = execFileSync(
    'docker',
    ['exec', 'supabase_kong_tryoutflow', 'cat', '/home/kong/kong.yml'],
    { encoding: 'utf8' },
  );
  serviceKey = config.match(/sb_secret_[A-Za-z0-9_-]+/u)?.[0] ?? '';
  publishableKey = config.match(/sb_publishable_[A-Za-z0-9_-]+/u)?.[0] ?? '';
  apiUrl = 'http://127.0.0.1:54321';
  if (!serviceKey || !publishableKey) throw new Error('local Supabase API keys unavailable');
});

function ownerAuthorization(organizationId: OrganizationId, userId: UserId): AuthorizationContext {
  return {
    userId,
    organizationId,
    organizationRole: 'owner',
    membershipStatus: 'active',
    assignments: [],
  };
}

describe('tryout journey against PostgreSQL and RLS', () => {
  it('advances through durable facts and denies a forged cross-tenant scope', async () => {
    const organizationId = randomUUID() as OrganizationId;
    const otherOrganizationId = randomUUID() as OrganizationId;
    const tryoutId = randomUUID();
    const otherTryoutId = randomUUID();
    const divisionId = randomUUID();
    const formId = randomUUID();
    const formVersionId = randomUUID();
    const athleteId = randomUUID();
    const registrationId = randomUUID();
    const sessionId = randomUUID();
    const enrollmentId = randomUUID();
    const rubricId = randomUUID();
    const rubricVersionId = randomUUID();
    const evaluationId = randomUUID();
    const rosterVersionId = randomUUID();
    const email = `journey-${organizationId}@example.test`;
    const password = `Journey-${randomUUID()}!`;
    const admin = createClient<Database>(apiUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error ?? new Error('user unavailable');
    const userId = created.data.user.id as UserId;
    let client: SupabaseClient<Database> | null = null;

    try {
      await psql(`
        insert into public.organizations(id,name,slug,timezone) values
          ('${organizationId}','Journey Integration','journey-${organizationId.slice(0, 8)}','America/Edmonton'),
          ('${otherOrganizationId}','Other Tenant Secret','other-${otherOrganizationId.slice(0, 8)}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status)
          values('${organizationId}','${userId}','owner','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone,status) values
          ('${tryoutId}','${organizationId}','Fall Evaluations','journey-tryout-${tryoutId.slice(0, 8)}','Hockey','America/Edmonton','draft'),
          ('${otherTryoutId}','${otherOrganizationId}','Other Tenant Secret Tryout','other-tryout-${otherTryoutId.slice(0, 8)}','Hockey','America/Edmonton','draft');
        insert into public.tryout_setup_progress(organization_id,tryout_id,completed_steps,last_step)
          values('${organizationId}','${tryoutId}',array['basics'],'basics');
        insert into public.tryout_staff_assignments(
          organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id
        ) values('${organizationId}','${userId}','evaluator','tryout','${tryoutId}','${userId}');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
          values('${divisionId}','${organizationId}','${tryoutId}','U15',0);
        insert into public.registration_forms(id,organization_id,tryout_id,name)
          values('${formId}','${organizationId}','${tryoutId}','Player registration');
        insert into public.registration_form_versions(
          id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at
        ) values(
          '${formVersionId}','${organizationId}','${tryoutId}','${formId}',1,'{"fields":[]}'::jsonb,'published',clock_timestamp()
        );
        insert into public.tryout_sessions(
          id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order
        ) values(
          '${sessionId}','${organizationId}','${tryoutId}','${divisionId}','Skills Session 1',
          clock_timestamp(),clock_timestamp()+interval '2 hours',0
        );
        insert into public.rubrics(id,organization_id,tryout_id,name)
          values('${rubricId}','${organizationId}','${tryoutId}','Skating and Game Sense');
        insert into public.rubric_versions(
          id,organization_id,tryout_id,rubric_id,version_number,status,published_at
        ) values(
          '${rubricVersionId}','${organizationId}','${tryoutId}','${rubricId}',1,'published',clock_timestamp()
        );
      `);
      client = createClient<Database>(apiUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      const scope = {
        organizationId,
        tryoutId,
        organizationSlug: `journey-${organizationId.slice(0, 8)}`,
        authorization: ownerAuthorization(organizationId, userId),
      };

      await expect(loadTryoutJourney(client, scope)).resolves.toMatchObject({
        nextStage: 'prepare',
        primaryAction: { label: 'Continue setup' },
      });

      await psql(`
        update public.tryouts set status='published',published_at=clock_timestamp()
          where organization_id='${organizationId}' and id='${tryoutId}';
      `);
      await expect(loadTryoutJourney(client, scope)).resolves.toMatchObject({
        nextStage: 'participants',
        primaryAction: { label: 'Add first participant' },
      });

      await psql(`
        insert into public.athletes(
          id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
        ) values('${athleteId}','${organizationId}','Jordan','Lee','jordan','lee','2012-09-15');
        insert into public.tryout_registrations(
          id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
          responses,source,status,submission_key_digest
        ) values(
          '${registrationId}','${organizationId}','${tryoutId}','${athleteId}','${divisionId}',
          '${formVersionId}','{}'::jsonb,'staff','submitted',repeat('a',64)
        );
      `);
      await expect(loadTryoutJourney(client, scope)).resolves.toMatchObject({
        nextStage: 'run',
        primaryAction: { label: 'Open check-in' },
      });

      await psql(`
        insert into public.session_enrollments(
          id,organization_id,tryout_id,registration_id,session_id
        ) values('${enrollmentId}','${organizationId}','${tryoutId}','${registrationId}','${sessionId}');
        set session_replication_role=replica;
        insert into public.evaluations(
          id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,
          evaluator_user_id,rubric_version_id,state,completed_at
        ) values(
          '${evaluationId}','${organizationId}','${tryoutId}','${divisionId}','${registrationId}',
          '${sessionId}','${userId}','${rubricVersionId}','completed',clock_timestamp()
        );
        set session_replication_role=origin;
      `);
      await expect(loadTryoutJourney(client, scope)).resolves.toMatchObject({
        nextStage: 'decide',
        primaryAction: { label: 'Review rankings' },
      });

      await psql(`
        insert into public.roster_versions(
          id,organization_id,tryout_id,division_id,revision_number,state,version,
          finalized_by_user_id,finalized_at,created_by_user_id
        ) values(
          '${rosterVersionId}','${organizationId}','${tryoutId}','${divisionId}',1,'finalized',1,
          '${userId}',clock_timestamp(),'${userId}'
        );
      `);
      await expect(loadTryoutJourney(client, scope)).resolves.toMatchObject({
        nextStage: 'complete',
        primaryAction: { label: 'Review communication' },
      });

      const forgedScope = {
        organizationId: otherOrganizationId,
        tryoutId: otherTryoutId,
        organizationSlug: `other-${otherOrganizationId.slice(0, 8)}`,
        authorization: ownerAuthorization(otherOrganizationId, userId),
      };
      await expect(loadTryoutJourney(client, forgedScope)).rejects.toEqual(
        expect.objectContaining({ code: 'not_found' }),
      );
    } finally {
      await psql(`
        begin;
        set local session_replication_role=replica;
        alter table public.roster_versions disable trigger prevent_finalized_roster_version_mutation;
        delete from public.roster_versions where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.evaluations where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.session_enrollments where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.tryout_registrations where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.athletes where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.rubric_versions where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.rubrics where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.registration_form_versions where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.registration_forms where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.tryout_staff_assignments where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.tryout_sessions where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.tryout_divisions where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.tryout_setup_progress where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.tryouts where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.organization_members where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.audit_logs where organization_id in ('${organizationId}','${otherOrganizationId}');
        delete from public.organizations where id in ('${organizationId}','${otherOrganizationId}');
        alter table public.roster_versions enable always trigger prevent_finalized_roster_version_mutation;
        commit;
      `);
      await admin.auth.admin.deleteUser(userId);
      await client?.auth.signOut();
    }
  });
});
