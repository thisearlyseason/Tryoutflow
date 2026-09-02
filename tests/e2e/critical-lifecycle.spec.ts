import { readFile } from 'node:fs/promises';

import Stripe from 'stripe';

import { openAuthenticatedContext, signInAs } from './helpers/auth';
import { expect, test, type Task30Scenario } from './helpers/fixtures';
import {
  expectCancellableServerAction,
  monitorBrowserErrors,
  reconnect,
  setOffline,
} from './helpers/network';

function scope(
  testInfo: import('@playwright/test').TestInfo,
  role: string,
  scenario: Task30Scenario,
) {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=${role}; organization=${scenario.organizationSlug}; tryout=${scenario.tryoutName} (${scenario.ids.tryout})`,
  });
}

async function queuedEvaluationMutation(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const database = (await indexedDB.databases()).find((candidate) =>
      candidate.name?.startsWith('tryoutflow-evaluations--u-'),
    );
    if (!database?.name) return null;
    return new Promise<{
      attemptCount: number;
      claimToken?: string;
      nextAttemptAt: string;
      status: string;
    } | null>((resolve, reject) => {
      const opening = indexedDB.open(database.name!);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const connection = opening.result;
        const transaction = connection.transaction('mutations', 'readonly');
        const reading = transaction.objectStore('mutations').getAll();
        reading.onerror = () => reject(reading.error);
        reading.onsuccess = () => {
          const record = reading.result[0] as
            | {
                attemptCount: number;
                claimToken?: string;
                nextAttemptAt: string;
                status: string;
              }
            | undefined;
          connection.close();
          resolve(record ?? null);
        };
      };
    });
  });
}

test('scenario 1 — new owner completes organization onboarding and publishes a configured tryout', async ({
  newOwner,
  page,
  task30Database,
}, testInfo) => {
  const organizationSlug = `task30-onboarding-${newOwner.id.slice(0, 8)}`;
  const organizationName = `Task 30 Onboarding ${newOwner.id.slice(0, 8)}`;
  const tryoutName = `Task 30 Published ${newOwner.id.slice(0, 8)}`;
  testInfo.annotations.push({
    type: 'scope',
    description: `role=owner; organization=${organizationSlug}; tryout=${tryoutName}`,
  });
  const monitor = await signInAs(page, newOwner);
  await expect(page).toHaveURL(/\/start$/u);
  await page.getByLabel('Organization name').fill(organizationName);
  await page.getByLabel('Organization URL').fill(organizationSlug);
  await page.getByLabel('Timezone').fill('America/Edmonton');
  expectCancellableServerAction(monitor, page, 'organization creation redirect');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${organizationSlug}/home$`, 'u'));
  await expect(
    page.getByRole('heading', { name: 'Your tryout operations checklist' }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.goto(`/app/${organizationSlug}/tryouts/new`);
  await page.getByLabel('Tryout name').fill(tryoutName);
  await page.getByLabel('Sport').fill('Hockey');
  await page.getByLabel('New cycle name').fill('2026 Fall Cycle');
  await page.getByLabel('Timezone').fill('America/Edmonton');
  await page.getByLabel('Registration opens').fill('2026-09-01T08:00');
  await page.getByLabel('Registration closes').fill('2026-09-30T20:00');
  expectCancellableServerAction(monitor, page, 'draft tryout creation redirect');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/setup\/basics$/u);

  await page.getByLabel('Name').fill(tryoutName);
  await page.getByLabel('Sport').fill('Hockey');
  await page.getByLabel('Timezone').fill('America/Edmonton');
  await page.getByLabel('Registration opens').fill('2026-09-01T08:00');
  await page.getByLabel('Registration closes').fill('2026-09-30T20:00');
  expectCancellableServerAction(monitor, page, 'wizard basics redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByLabel('Division name')).toBeVisible();
  await page.getByLabel('Division name').fill('U15');
  expectCancellableServerAction(monitor, page, 'wizard divisions redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByLabel('Session name')).toBeVisible();
  await page.getByLabel('Division').selectOption({ label: 'U15' });
  await page.getByLabel('Session name').fill('Skills session');
  await page.getByLabel('Starts').fill('2026-10-01T16:00');
  await page.getByLabel('Ends').fill('2026-10-01T18:00');
  await page.getByLabel('Position (optional)').fill('Forward');
  expectCancellableServerAction(monitor, page, 'wizard sessions redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByLabel('Form name')).toBeVisible();
  await page.getByLabel('Form name').fill('Guardian registration');
  expectCancellableServerAction(monitor, page, 'wizard registration redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByLabel('Rubric name')).toBeVisible();
  await page.getByLabel('Session').selectOption({ label: 'Skills session' });
  await page.getByLabel('Rubric name').fill('Skating rubric');
  await page.getByLabel('Category name').fill('Skating');
  expectCancellableServerAction(monitor, page, 'wizard rubric redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review setup' })).toBeVisible();
  await expect(page.getByText('Publishing is blocked')).toHaveCount(0);
  expectCancellableServerAction(monitor, page, 'wizard review redirect');
  await page.getByRole('button', { name: 'Ready to publish' }).click();
  await page.getByLabel(`Type “${tryoutName}” to publish`).fill(tryoutName);
  expectCancellableServerAction(monitor, page, 'tryout publication redirect');
  await page.getByRole('button', { name: 'Publish tryout' }).click();
  await expect(page.getByRole('heading', { name: tryoutName })).toBeVisible();
  await expect(page.getByText('published', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Registration link' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open public registration' })).toHaveAttribute(
    'href',
    /\/register\/task-30-published-/u,
  );
  expect(
    task30Database.scalar(
      `select to_char(tryout.registration_starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'|'||to_char(tryout.registration_ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'|'||to_char(session.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'|'||to_char(session.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.tryouts tryout join public.tryout_sessions session on session.organization_id=tryout.organization_id and session.tryout_id=tryout.id join public.organizations organization on organization.id=tryout.organization_id where organization.slug='${organizationSlug}' and tryout.name='${tryoutName}' and session.name='Skills session'`,
    ),
  ).toBe('2026-09-01T14:00:00Z|2026-10-01T02:00:00Z|2026-10-01T22:00:00Z|2026-10-02T00:00:00Z');
  monitor.assertClean();
});

test('scenarios 2–3 — guardian confirmation is visible to the administrator and check-in assigns exactly one number', async ({
  baseURL,
  browser,
  page,
  scenario,
}, testInfo) => {
  scope(testInfo, 'guardian/public → administrator → checkin', scenario);
  const publicMonitor = monitorBrowserErrors(page);
  const publicSlug = `${scenario.organizationSlug}-critical-flow`;
  const familyName = `Registered-${scenario.key}`;
  const guardianEmail = `guardian-${scenario.key}@example.test`;

  await page.setExtraHTTPHeaders({ 'x-vercel-forwarded-for': scenario.publicClientAddress });
  await page.goto(`/register/${publicSlug}`);
  await page.getByLabel('Athlete first name').fill('Browser');
  await page.getByLabel('Athlete last name').fill(familyName);
  await page.getByLabel('Date of birth').fill('2013-05-01');
  await page.getByLabel('Division').selectOption(scenario.ids.division);
  await page.getByLabel('Guardian name').fill('Task 30 Guardian');
  await page.getByLabel('Guardian email').fill(guardianEmail);
  await page.getByLabel('I consent').check();
  const submitted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/public/registrations'),
  );
  await page.getByRole('button', { name: 'Submit registration' }).click();
  const submission = await submitted;
  expect(submission.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/register/${publicSlug}/confirmation`, 'u'));
  await expect(page.getByRole('status')).toContainText(/confirmation link has been queued/i);
  await page.waitForLoadState('networkidle');
  const queuedText = scenario.database.scalar(
    `select message.content_snapshot->>'text' from public.communication_messages message join public.tryout_registrations registration on registration.id=message.source_registration_id join public.athletes athlete on athlete.id=registration.athlete_id where message.organization_id='${scenario.ids.organization}' and athlete.family_name='${familyName}' and message.message_kind='registration_confirmation' order by message.created_at desc,message.id desc limit 1`,
  );
  const confirmationToken = /[?&]token=([0-9a-f]{64})(?:&|$)/iu.exec(queuedText)?.[1];
  expect(confirmationToken).toMatch(/^[0-9a-f]{64}$/u);
  scenario.database.trackPublicRateTarget('confirmation', confirmationToken!);
  await page.goto(`/register/${publicSlug}/confirmation?token=${confirmationToken}`);
  await page.getByRole('button', { name: 'Confirm registration' }).click();
  await expect(page.getByText('Your registration is confirmed.')).toBeVisible();
  publicMonitor.assertClean();
  publicMonitor.stop();
  const monitor = await signInAs(page, scenario.users.administrator, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/athletes`);
  await expect(page.getByRole('link', { name: `Browser ${familyName}` })).toBeVisible();

  expect(
    scenario.database.scalar(`begin;
      set local role authenticated;
      set local "request.jwt.claim.sub"='${scenario.users.checkin.id}';
      select
        (select count(*) from public.tryouts where id='${scenario.ids.tryout}')::text || ':' ||
        (select count(*) from public.tryout_sessions where id='${scenario.ids.session}')::text || ':' ||
        public.has_active_configuration_assignment('${scenario.ids.organization}','${scenario.ids.tryout}','${scenario.ids.division}','${scenario.ids.session}',null,'checkin')::text;
      `),
  ).toBe('1:1:true');

  const checkin = await openAuthenticatedContext({
    browser,
    baseURL: baseURL!,
    user: scenario.users.checkin,
    organizationSlug: scenario.organizationSlug,
  });
  try {
    await checkin.page.goto(
      `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/check-in`,
    );
    await checkin.page.getByLabel('Search registrations').fill(familyName);
    await checkin.page.getByRole('button', { name: 'Search' }).click();
    await expect(
      checkin.page.getByRole('heading', { name: `Browser ${familyName}` }),
    ).toBeVisible();
    await checkin.page.waitForLoadState('networkidle');
    await checkin.page.getByLabel('Requested number (optional)').fill('77');
    expectCancellableServerAction(checkin.monitor, checkin.page, 'idempotent check-in action');
    await checkin.page.getByRole('button', { name: `Check in Browser ${familyName}` }).dblclick();
    await expect(checkin.page.getByRole('status')).toContainText(/checked in|already checked in/i);
    await expect(checkin.page.getByText('#77 · checked in')).toBeVisible();
    checkin.monitor.assertClean();
  } finally {
    await checkin.context.close();
  }
  expect(
    scenario.database.scalar(
      `select count(*) from public.tryout_numbers number join public.tryout_registrations registration on registration.id=number.registration_id join public.athletes athlete on athlete.id=registration.athlete_id where number.organization_id='${scenario.ids.organization}' and athlete.family_name='${familyName}'`,
    ),
  ).toBe('1');
  monitor.assertClean();
});

test('scenario 4 — three independent evaluators produce exact 84.0000 aggregate without peer leakage', async ({
  baseURL,
  browser,
  scenario,
}, testInfo) => {
  scope(testInfo, 'evaluator-one/evaluator-two/evaluator-three → director', scenario);
  const sessions = await Promise.all(
    [
      [scenario.users.evaluatorOne, 1, '82'],
      [scenario.users.evaluatorTwo, 3, '86'],
      [scenario.users.evaluatorThree, 2, '84'],
    ].map(async ([user, control, expected]) => {
      const opened = await openAuthenticatedContext({
        browser,
        baseURL: String(baseURL),
        user: user as typeof scenario.users.evaluatorOne,
        organizationSlug: scenario.organizationSlug,
      });
      return { ...opened, control: Number(control), expected: String(expected) };
    }),
  );
  try {
    for (const { page, monitor, control, expected } of sessions) {
      await page.goto(
        `/app/${scenario.organizationSlug}/evaluate/session/${scenario.ids.session}/athletes/${scenario.ids.registrationA}`,
      );
      await expect(page.getByRole('heading', { name: 'Exact Aggregate' })).toBeVisible();
      await page.getByRole('radio', { name: `Control score ${control} of 10` }).click();
      await page.getByRole('radio', { name: 'Finish score 10 of 10' }).click();
      await page.getByLabel('Private evaluator note').fill(`private ${expected}`);
      await page.getByRole('button', { name: 'Save now' }).click();
      await expect(page.getByText('Saved on server', { exact: true })).toBeVisible();
      expectCancellableServerAction(
        monitor,
        page,
        `evaluation completion for independent score ${expected}`,
      );
      await page.getByRole('button', { name: 'Complete evaluation' }).click();
      await expect(page.getByRole('button', { name: 'Evaluation completed' })).toBeDisabled();
      await page.waitForLoadState('networkidle');
      for (const peer of ['82', '84', '86'].filter((score) => score !== expected)) {
        await expect(page.locator('body')).not.toContainText(`private ${peer}`);
      }
      await expect(page.locator('body')).not.toContainText(/84\.0000|peer score/iu);
      monitor.assertClean();
    }
    const director = await openAuthenticatedContext({
      browser,
      baseURL: String(baseURL),
      user: scenario.users.director,
      organizationSlug: scenario.organizationSlug,
    });
    try {
      await director.page.goto(
        `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`,
      );
      const row = director.page.getByRole('listitem').filter({ hasText: 'Exact Aggregate' });
      await expect(row).toContainText('84.0');
      await expect(row).toContainText('3 of 3 evaluations complete');
      await expect(row).toContainText('82.0–86.0');
      director.monitor.assertClean();
    } finally {
      await director.context.close();
    }
  } finally {
    await Promise.all(sessions.map(({ context }) => context.close()));
  }
  expect(
    scenario.database.scalar(
      `select to_char(avg(weighted.total),'FM999990.0000') from (select evaluation.id,sum(score.value::numeric/category.scale_max::numeric*category.weight::numeric) as total from public.evaluations evaluation join public.evaluation_scores score on score.evaluation_id=evaluation.id join public.rubric_categories category on category.id=score.rubric_category_id where evaluation.organization_id='${scenario.ids.organization}' and evaluation.tryout_registration_id='${scenario.ids.registrationA}' and evaluation.state='completed' group by evaluation.id) weighted`,
    ),
  ).toBe('84.0000');
});

test('scenario 5 — offline evaluator draft survives reload and reconnect synchronizes exactly once', async ({
  page,
  scenario,
}, testInfo) => {
  scope(testInfo, 'evaluator-three', scenario);
  const monitor = await signInAs(page, scenario.users.evaluatorThree, scenario.organizationSlug);
  monitor.expectRequestFailure({
    count: 1,
    errorText: [
      'net::ERR_FAILED',
      'net::ERR_ABORTED',
      'NS_ERROR_FAILURE',
      'Load failed',
      'Blocked by Web Inspector',
    ],
    label: 'one deliberately failed offline evaluation synchronization request',
    method: 'POST',
    url: new RegExp(`^http://127\\.0\\.0\\.1:3112/api/evaluations/[^/]+/mutations$`, 'u'),
  });
  if (testInfo.project.name === 'chromium' || testInfo.project.name === 'Mobile Chrome') {
    monitor.expectConsoleError({
      count: 1,
      label: 'Chromium diagnostic for the deliberately failed offline synchronization',
      text: 'Failed to load resource: net::ERR_FAILED',
    });
  }
  await page.goto(
    `/app/${scenario.organizationSlug}/evaluate/session/${scenario.ids.session}/athletes/${scenario.ids.registrationD}`,
  );
  let mutations = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/evaluations/')) {
      mutations += 1;
    }
  });
  await setOffline(page.context());
  await page.getByRole('radio', { name: 'Control score 2 of 10' }).click();
  await page.getByRole('radio', { name: 'Finish score 10 of 10' }).click();
  await page.getByLabel('Private evaluator note').fill('Exact durable offline draft');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on device');
  expect(mutations).toBe(0);
  await page.route('**/api/evaluations/**', (route) => route.abort('failed'));
  const failedSynchronizationRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/evaluations/'),
  );
  await reconnect(page.context(), page);
  await failedSynchronizationRequest;
  await page.reload();
  await expect(page.getByLabel('Private evaluator note')).toHaveValue(
    'Exact durable offline draft',
  );
  await expect.poll(() => mutations).toBe(1);
  await expect
    .poll(async () => {
      const mutation = await queuedEvaluationMutation(page);
      return mutation
        ? {
            attemptCount: mutation.attemptCount,
            claimed: mutation.claimToken !== undefined,
            status: mutation.status,
          }
        : null;
    })
    .toEqual({ attemptCount: 1, claimed: false, status: 'pending' });
  mutations = 0;
  await page.unroute('**/api/evaluations/**');
  await expect
    .poll(async () => {
      const mutation = await queuedEvaluationMutation(page);
      return mutation ? mutation.nextAttemptAt <= new Date().toISOString() : false;
    })
    .toBe(true);
  const synchronizationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/api/evaluations/'),
  );
  await reconnect(page.context(), page);
  const synchronized = await synchronizationResponse;
  expect(
    synchronized.ok(),
    JSON.stringify({ status: synchronized.status(), response: await synchronized.text() }),
  ).toBe(true);
  await expect(page.getByText('Saved on server', { exact: true })).toBeVisible();
  expect(mutations).toBe(1);
  await page.reload();
  await expect(page.getByLabel('Private evaluator note')).toHaveValue(
    'Exact durable offline draft',
  );
  expect(
    scenario.database.scalar(
      `select count(*) from public.evaluations where organization_id='${scenario.ids.organization}' and tryout_registration_id='${scenario.ids.registrationD}' and evaluator_user_id='${scenario.users.evaluatorThree.id}'`,
    ),
  ).toBe('1');
  monitor.assertClean();
});

test('scenarios 8–9 — director finalizes and revises an audited roster, then queues a separate exact message batch', async ({
  context,
  page,
  scenario,
}, testInfo) => {
  scope(testInfo, 'director', scenario);
  const monitor = await signInAs(page, scenario.users.director, scenario.organizationSlug);
  const rosterPath = `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters?division=${scenario.ids.division}`;
  await page.goto(rosterPath);
  await expect(page.getByRole('heading', { name: 'Create a draft roster' })).toBeVisible();
  await page.getByLabel('Team 1 name').fill('UI Blue');
  await page.getByLabel('Team 1 roster target').fill('3');
  await page.getByLabel('Team 2 name').fill('UI Gold');
  await page.getByLabel('Team 2 roster target').fill('3');
  expectCancellableServerAction(monitor, page, 'UI roster creation action');
  await page.getByRole('button', { name: 'Create draft roster' }).click();
  await expect(page.getByText('Draft roster · version 1')).toBeVisible();
  const createdRosterId = scenario.database.scalar(
    `select id from public.roster_versions where organization_id='${scenario.ids.organization}' and tryout_id='${scenario.ids.tryout}' and division_id='${scenario.ids.division}' and revision_number=1`,
  );
  expect(createdRosterId).toMatch(/^[0-9a-f-]{36}$/u);
  const uiBlue = scenario.database.scalar(
    `select id from public.tryout_teams where organization_id='${scenario.ids.organization}' and division_id='${scenario.ids.division}' and name='UI Blue'`,
  );
  const uiGold = scenario.database.scalar(
    `select id from public.tryout_teams where organization_id='${scenario.ids.organization}' and division_id='${scenario.ids.division}' and name='UI Gold'`,
  );
  await page.getByRole('button', { name: 'Move Exact Aggregate' }).click();
  await page.getByLabel('Destination team').selectOption(uiGold);
  expectCancellableServerAction(monitor, page, 'UI roster placement action');
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'placement saved' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Draft roster · version 2')).toBeVisible();
  await page.getByLabel('Select Exact Aggregate').check();
  await page.getByLabel('Bulk decision').selectOption('selected');
  await page.getByRole('button', { name: 'Review decision for 1 athlete' }).click();
  expectCancellableServerAction(monitor, page, 'UI roster decision action');
  await page.getByRole('button', { name: 'Confirm decisions' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No messages were sent' })).toBeVisible();

  const stalePage = await context.newPage();
  const staleMonitor = monitorBrowserErrors(stalePage);
  await stalePage.goto(rosterPath);
  await expect(stalePage.getByText('Draft roster · version 3')).toBeVisible();

  await page.getByRole('button', { name: 'Finalize roster' }).click();
  await page.getByLabel('I understand this roster becomes immutable').check();
  expectCancellableServerAction(monitor, page, 'UI roster finalization action');
  await page.getByRole('button', { name: 'Confirm finalization' }).click();
  await expect(page.getByText('Finalized roster · immutable')).toBeVisible();
  await expect(page.getByText('Recorded in the roster audit trail.')).toBeVisible();
  expect(
    scenario.database.scalar(
      `select action||':'||entity_type||':'||entity_id::text from public.audit_logs where organization_id='${scenario.ids.organization}' and action='roster.finalized' and entity_id='${createdRosterId}'`,
    ),
  ).toBe(`roster.finalized:roster_version:${createdRosterId}`);
  const finalizedStateDigest = scenario.database.scalar(
    `select md5((select to_jsonb(roster)::text from public.roster_versions roster where roster.id='${createdRosterId}')||(select coalesce(jsonb_agg(to_jsonb(assignment) order by assignment.registration_id)::text,'[]') from public.roster_assignments assignment where assignment.roster_version_id='${createdRosterId}')||(select coalesce(jsonb_agg(to_jsonb(decision) order by decision.registration_id)::text,'[]') from public.roster_decisions decision where decision.roster_version_id='${createdRosterId}'))`,
  );
  const finalizedAuditCount = scenario.database.scalar(
    `select count(*) from public.audit_logs where organization_id='${scenario.ids.organization}' and entity_id='${createdRosterId}'`,
  );

  await stalePage.getByRole('button', { name: 'Move Exact Aggregate' }).click();
  await stalePage.getByLabel('Destination team').selectOption(uiBlue);
  expectCancellableServerAction(staleMonitor, stalePage, 'denied stale roster placement action');
  await stalePage.getByRole('button', { name: 'Confirm move' }).click();
  await expect(
    stalePage.getByRole('alert').filter({ hasText: /Roster changed elsewhere/i }),
  ).toBeFocused();
  expect(
    scenario.database.scalar(
      `select md5((select to_jsonb(roster)::text from public.roster_versions roster where roster.id='${createdRosterId}')||(select coalesce(jsonb_agg(to_jsonb(assignment) order by assignment.registration_id)::text,'[]') from public.roster_assignments assignment where assignment.roster_version_id='${createdRosterId}')||(select coalesce(jsonb_agg(to_jsonb(decision) order by decision.registration_id)::text,'[]') from public.roster_decisions decision where decision.roster_version_id='${createdRosterId}'))`,
    ),
  ).toBe(finalizedStateDigest);
  expect(
    scenario.database.scalar(
      `select count(*) from public.audit_logs where organization_id='${scenario.ids.organization}' and entity_id='${createdRosterId}'`,
    ),
  ).toBe(finalizedAuditCount);
  staleMonitor.assertClean();
  await stalePage.close();

  await page.getByRole('button', { name: 'Create revision' }).click();
  await page
    .getByLabel('Revision reason')
    .fill('Task 30 verified correction after independent director review.');
  expectCancellableServerAction(monitor, page, 'UI roster revision action');
  await page.getByRole('button', { name: 'Confirm revision' }).click();
  await expect(page.getByText('Roster revision 2')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(
    scenario.database.scalar(
      `select count(*) from public.audit_logs where organization_id='${scenario.ids.organization}' and action='roster.revised' and entity_id=(select id from public.roster_versions where organization_id='${scenario.ids.organization}' and based_on_roster_version_id='${createdRosterId}')`,
    ),
  ).toBe('1');
  monitor.assertClean();
  monitor.stop();

  const messagesPage = await context.newPage();
  const messagesMonitor = monitorBrowserErrors(messagesPage);
  await messagesPage.goto(
    `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/messages`,
  );
  await messagesPage.getByLabel('Finalized roster').selectOption(scenario.ids.finalRoster);
  await messagesPage.getByRole('button', { name: 'Preview exact recipients' }).click();
  await expect(
    messagesPage.getByRole('heading', { name: 'Exact recipient preview · 1' }),
  ).toBeVisible();
  await expect(
    messagesPage.getByText(`Final · selected-${scenario.key}@example.test`),
  ).toBeVisible();
  await messagesPage.getByLabel('Type SEND EXACT BATCH to confirm').fill('SEND EXACT BATCH');
  expectCancellableServerAction(
    messagesMonitor,
    messagesPage,
    'exact recipient batch queue action',
  );
  await messagesPage.getByRole('button', { name: 'Confirm and queue exactly 1' }).click();
  await expect(messagesPage.getByRole('status')).toContainText(
    '1 message queued. Decisions were not changed.',
  );
  await messagesPage.waitForLoadState('networkidle');
  messagesMonitor.assertClean();

  const deliveryPage = await context.newPage();
  const deliveryMonitor = monitorBrowserErrors(deliveryPage);
  await deliveryPage.goto(
    `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/messages`,
  );
  const deliveryStatus = deliveryPage.getByRole('region', { name: 'Delivery status' });
  await expect(deliveryStatus.getByText('Final', { exact: true })).toBeVisible();
  await expect(deliveryStatus.getByText('Queued', { exact: true })).toBeVisible();
  deliveryMonitor.assertClean();
  await Promise.all([messagesPage.close(), deliveryPage.close()]);
  expect(
    scenario.database.scalar(
      `select status from public.roster_decisions where organization_id='${scenario.ids.organization}' and roster_version_id='${scenario.ids.finalRoster}' and registration_id='${scenario.ids.finalRegistrationA}'`,
    ),
  ).toBe('selected');
});

test('scenario 12 plus reporting — fake Stripe handoff, verified webhook state, portal, cancellation, and sanitized downloads cross real app/DB boundaries', async ({
  browserName,
  page,
  request,
  scenario,
}, testInfo) => {
  scope(testInfo, 'owner', scenario);
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  // Chromium reports a completed attachment handoff as a failed document
  // navigation. WebKit may emit the equivalent event depending on its mobile
  // navigation handoff, so bound it to at most one exact artifact.
  if (browserName === 'chromium') {
    monitor.expectRequestFailure({
      count: 1,
      errorText: 'net::ERR_ABORTED',
      label: 'one Chromium download handoff cancellation after the roster CSV response',
      method: 'GET',
      url: new RegExp(
        `^http://127\\.0\\.0\\.1:3112/api/organizations/${scenario.ids.organization}/exports/roster\\?[^#]*rosterVersionId=${scenario.ids.finalRoster}(?:&[^#]*)?$`,
        'u',
      ),
    });
  } else if (browserName === 'webkit') {
    monitor.allowOptionalRequestFailure({
      errorText: 'Frame load interrupted',
      label: 'one WebKit download handoff interruption after the roster CSV response',
      maxCount: 1,
      method: 'GET',
      url: new RegExp(
        `^http://127\\.0\\.0\\.1:3112/api/organizations/${scenario.ids.organization}/exports/roster\\?[^#]*rosterVersionId=${scenario.ids.finalRoster}(?:&[^#]*)?$`,
        'u',
      ),
    });
  }
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Stripe test checkout boundary</h1>' }),
  );
  await page.goto(`/app/${scenario.organizationSlug}/organization/billing`);
  await expect(page.getByRole('status')).toContainText('Trial active');
  const [checkoutResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/billing/checkout'),
    ),
    page.getByRole('button', { name: 'Choose Team' }).click(),
  ]);
  expect(checkoutResponse.status()).toBe(200);
  await expect(page).toHaveURL(/https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/u);
  await expect(page.getByRole('heading', { name: 'Stripe test checkout boundary' })).toBeVisible();

  const webhookSecret = 'whsec_task30_local_contract_secret';
  const stripe = new Stripe(`sk_test_${'x'.repeat(32)}`);
  const providerCreatedAt = Math.floor(Date.now() / 1_000);
  const providerKey = scenario.key.replaceAll('-', '');
  const eventBody = JSON.stringify({
    id: `evt_${providerKey}active`,
    object: 'event',
    created: providerCreatedAt,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: `sub_${providerKey}`,
        object: 'subscription',
        customer: `cus_${providerKey}`,
        status: 'active',
        metadata: { organization_id: scenario.ids.organization },
        items: {
          has_more: false,
          data: [
            {
              price: { id: 'price_Task30Team' },
              current_period_start: providerCreatedAt - 60,
              current_period_end: providerCreatedAt + 3_600,
            },
          ],
        },
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
        trial_end: null,
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: eventBody,
    secret: webhookSecret,
  });
  const applied = await request.post('/api/webhooks/stripe', {
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    data: Buffer.from(eventBody),
  });
  expect(applied.ok(), await applied.text()).toBe(true);
  const replayed = await request.post('/api/webhooks/stripe', {
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    data: Buffer.from(eventBody),
  });
  expect(await replayed.json()).toEqual({ outcome: 'replayed' });

  await page.route('https://billing.stripe.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Stripe test portal boundary</h1>' }),
  );
  await page.goto(`/app/${scenario.organizationSlug}/organization/billing`);
  await expect(page.getByRole('status')).toContainText('Team plan active');
  await page.getByRole('button', { name: 'Manage billing' }).click();
  await expect(page).toHaveURL(/https:\/\/billing\.stripe\.com\/p\/session\/test_/u);
  await expect(page.getByRole('heading', { name: 'Stripe test portal boundary' })).toBeVisible();

  const canceledBody = eventBody
    .replace('active"', 'canceled"')
    .replace('"customer.subscription.updated"', '"customer.subscription.deleted"')
    .replace('"status":"active"', '"status":"canceled"')
    .replace('"canceled_at":null', `"canceled_at":${providerCreatedAt}`);
  const canceledSignature = stripe.webhooks.generateTestHeaderString({
    payload: canceledBody,
    secret: webhookSecret,
  });
  const canceled = await request.post('/api/webhooks/stripe', {
    headers: { 'content-type': 'application/json', 'stripe-signature': canceledSignature },
    data: Buffer.from(canceledBody),
  });
  expect(canceled.ok(), await canceled.text()).toBe(true);
  await page.goto(`/app/${scenario.organizationSlug}/organization/billing`);
  await expect(page.getByRole('status')).toContainText('Subscription canceled');
  expect(
    scenario.database.scalar(
      `select state||':'||provider_customer_id||':'||provider_subscription_id from public.subscription_accounts where organization_id='${scenario.ids.organization}'`,
    ),
  ).toBe(`canceled:cus_${providerKey}:sub_${providerKey}`);
  expect(
    scenario.database.scalar(
      `select count(*) from public.subscription_events where organization_id='${scenario.ids.organization}'`,
    ),
  ).toBe('2');
  expect(
    scenario.database.scalar(
      `select count(*) from public.subscription_checkout_intents where organization_id='${scenario.ids.organization}' and state='expired' and provider_session_id is null and result_url is null`,
    ),
  ).toBe('1');

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/reports`);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download finalized roster CSV' }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, 'utf8');
  expect(csv).toContain('Athlete number,Preferred name,Decision,Team');
  expect(csv).toContain('Final,selected,Final Blue');
  expect(csv).not.toMatch(/guardian|email|phone|private note|evaluator/iu);
  monitor.assertClean();
});
