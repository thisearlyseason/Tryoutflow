import { signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import {
  expectCancellableServerAction,
  holdResponseAfterApplicationCommit,
  loseResponseAfterApplicationCommit,
  monitorBrowserErrors,
} from './helpers/network';

test('rankings preserve an exact tie and compare both athletes with completion evidence', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=director; organization=${scenario.organizationSlug}; tryout=${scenario.tryoutName} (${scenario.ids.tryout}); athletes=Tie Alpha/Tie Beta`,
  });
  await signInAs(page, scenario.users.director, scenario.organizationSlug);
  const monitor = monitorBrowserErrors(page);
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`);
  const alpha = page.getByRole('listitem').filter({ hasText: 'Tie Alpha' });
  const beta = page.getByRole('listitem').filter({ hasText: 'Tie Beta' });
  await expect(alpha).toContainText('Tied at rank 1');
  await expect(beta).toContainText('Tied at rank 1');
  await expect(alpha).toContainText('84.0');
  await expect(beta).toContainText('84.0');
  await expect(alpha).toContainText('1 of 3 evaluations complete');
  await page.getByLabel('Select Tie Alpha for comparison').check();
  await page.getByLabel('Select Tie Beta for comparison').check();
  await page.getByRole('link', { name: 'Compare selected (2/4)' }).click();
  await expect(page.getByRole('heading', { name: 'Athlete comparison' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Tie Alpha');
  await expect(page.getByRole('table')).toContainText('Tie Beta');
  await expect(page.getByRole('table')).toContainText('Control');
  await expect(page.getByRole('table')).toContainText('Finish');
  expect(
    scenario.database.scalar(
      `select string_agg(to_char(weighted.total,'FM999990.0000'),',' order by weighted.registration_id) from (select evaluation.tryout_registration_id as registration_id,sum(score.value::numeric/category.scale_max::numeric*category.weight::numeric) as total from public.evaluations evaluation join public.evaluation_scores score on score.evaluation_id=evaluation.id join public.rubric_categories category on category.id=score.rubric_category_id where evaluation.organization_id='${scenario.ids.organization}' and evaluation.tryout_registration_id in('${scenario.ids.registrationB}','${scenario.ids.registrationC}') and evaluation.state='completed' group by evaluation.tryout_registration_id,evaluation.id) weighted`,
    ),
  ).toBe('84.0000,84.0000');
  monitor.assertClean();
});

test('two director tabs reject a stale roster mutation after the first committed write', async ({
  context,
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=director; organization=${scenario.organizationSlug}; tryout=${scenario.tryoutName} (${scenario.ids.tryout}); roster=${scenario.ids.draftRoster}`,
  });
  await signInAs(page, scenario.users.director, scenario.organizationSlug);
  const monitor = monitorBrowserErrors(page);
  const sibling = await context.newPage();
  const siblingMonitor = monitorBrowserErrors(sibling);
  const path = `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters?division=${scenario.ids.rosterDivision}`;
  await Promise.all([page.goto(path), sibling.goto(path)]);

  const delayed = await holdResponseAfterApplicationCommit(
    page,
    (request) => request.method() === 'POST' && request.url().includes('/rosters'),
  );
  await page.getByRole('button', { name: 'Move Roster Mover' }).click();
  await page.getByLabel('Destination team').selectOption(scenario.ids.draftTeamGold);
  expectCancellableServerAction(monitor, page, 'delayed first-tab roster mutation');
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await delayed.requested;

  await sibling.getByRole('button', { name: 'Move Roster Mover' }).click();
  await sibling.getByLabel('Destination team').selectOption(scenario.ids.draftTeamBlue);
  expectCancellableServerAction(siblingMonitor, sibling, 'stale sibling roster mutation');
  await sibling.getByRole('button', { name: 'Confirm move' }).dblclick();
  await expect(
    sibling.getByRole('alert').filter({ hasText: /Roster changed elsewhere/i }),
  ).toBeFocused();
  delayed.release();
  await expect(page.getByRole('status').filter({ hasText: 'placement saved' })).toBeVisible();
  await delayed.cleanup();
  expect(
    scenario.database.scalar(
      `select count(*) from public.roster_assignments where organization_id='${scenario.ids.organization}' and roster_version_id='${scenario.ids.draftRoster}' and registration_id='${scenario.ids.rosterRegistrationA}' and team_id='${scenario.ids.draftTeamGold}'`,
    ),
  ).toBe('1');
  await page.waitForLoadState('networkidle');
  await sibling.waitForLoadState('networkidle');
  siblingMonitor.assertClean();
  monitor.assertClean();
});

test('scenarios 10–11 — mock connection preview survives lost response, partial execution retries only failed items, and replay never duplicates', async ({
  page,
  request,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=owner; organization=${scenario.organizationSlug}; tryout=${scenario.tryoutName} (${scenario.ids.tryout}); finalizedRoster=${scenario.ids.finalRoster}; provider=The Squad demo/mock`,
  });
  await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const monitor = monitorBrowserErrors(page);
  monitor.expectRequestFailure({
    count: 1,
    errorText: ['net::ERR_FAILED', 'NS_ERROR_FAILURE', 'Load failed', 'Blocked by Web Inspector'],
    headers: { 'next-action': /.+/u },
    label: 'one deliberately lost roster export confirmation response',
    method: 'POST',
    url: new RegExp(
      `^http://127\\.0\\.0\\.1:3112/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters/${scenario.ids.finalRoster}/export$`,
      'u',
    ),
  });
  if (testInfo.project.name === 'chromium' || testInfo.project.name === 'Mobile Chrome') {
    monitor.expectConsoleError({
      count: 1,
      label: 'Chromium diagnostic for the deliberately lost export response',
      text: 'Failed to load resource: net::ERR_FAILED',
    });
  }
  await page.goto(`/app/${scenario.organizationSlug}/organization/integrations`);
  await expect(page.getByText(/demo\/mock only/i).first()).toBeVisible();
  expectCancellableServerAction(monitor, page, 'demo provider connection redirect');
  await page.getByRole('button', { name: 'Connect demo provider' }).click();
  await expect(page.getByText(/demo\/mock connection is ready/i)).toBeVisible();
  await page.waitForLoadState('networkidle');

  const exportPath = `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters/${scenario.ids.finalRoster}/export`;
  await page.goto(exportPath);
  await page.getByLabel('External destination').selectOption('mock-team-blue');
  await page.getByLabel('First name').check();
  await page.getByLabel('Last name').check();
  await page.getByLabel('Team name').check();
  await page.getByRole('button', { name: 'Preview export' }).click();
  await expect(page.getByRole('heading', { name: 'Review 2 athletes' })).toBeVisible();
  await expect(page.getByText('Final', { exact: true }).first()).toBeVisible();
  await page.getByLabel('I reviewed the exact destination and fields').check();

  let confirmationAttempts = 0;
  page.on('request', (candidate) => {
    if (candidate.method() === 'POST' && candidate.url().endsWith('/export')) {
      confirmationAttempts += 1;
    }
  });
  const cleanupLoss = await loseResponseAfterApplicationCommit(
    page,
    (candidate) => candidate.method() === 'POST' && candidate.url().includes('/export'),
  );
  await page.getByRole('button', { name: 'Confirm and queue export' }).click();
  await expect(page.getByText(/Confirmation could not be completed/u)).toBeVisible();
  await cleanupLoss();
  const firstIntent = scenario.database.scalar(
    `select id::text||'|'||business_idempotency_key||'|'||source_preview_id::text from public.integration_sync_jobs where organization_id='${scenario.ids.organization}' and roster_version_id='${scenario.ids.finalRoster}'`,
  );
  const replayResponse = page.waitForResponse(
    (candidate) => candidate.request().method() === 'POST' && candidate.url().endsWith('/export'),
  );
  await page.getByRole('button', { name: 'Confirm and queue export' }).click();
  expect((await replayResponse).ok()).toBe(true);
  await expect(page.getByText(/Export queued/u)).toBeVisible();
  expect(confirmationAttempts).toBe(2);
  expect(
    scenario.database.scalar(
      `select id::text||'|'||business_idempotency_key||'|'||source_preview_id::text from public.integration_sync_jobs where organization_id='${scenario.ids.organization}' and roster_version_id='${scenario.ids.finalRoster}'`,
    ),
  ).toBe(firstIntent);
  expect(
    scenario.database.scalar(
      `select (select count(*) from public.integration_sync_jobs where organization_id='${scenario.ids.organization}' and roster_version_id='${scenario.ids.finalRoster}')::text||':'||(select count(*) from public.integration_outbox_jobs where organization_id='${scenario.ids.organization}')::text||':'||(select count(*) from public.integration_sync_items where organization_id='${scenario.ids.organization}')::text`,
    ),
  ).toBe('1:1:2');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Latest durable job' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText(/pending|sent|failed/i);
  expect(
    scenario.database.scalar(
      `select count(*) from public.integration_sync_jobs where organization_id='${scenario.ids.organization}' and roster_version_id='${scenario.ids.finalRoster}'`,
    ),
  ).toBe('1');

  const firstRun = await request.post('/api/jobs/process', {
    headers: { authorization: `Bearer ${'task30-local-job-secret'.padEnd(40, 'j')}` },
    data: { batchSize: 10 },
  });
  expect(firstRun.ok(), await firstRun.text()).toBe(true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('1 completed');
  await expect(page.getByRole('status')).toContainText('1 failed/reviewable');
  await page.getByRole('button', { name: 'Retry 1 failed item' }).dblclick();
  await expect(page.getByText(/Completed items were preserved/u)).toBeVisible();
  const retryRun = await request.post('/api/jobs/process', {
    headers: { authorization: `Bearer ${'task30-local-job-secret'.padEnd(40, 'j')}` },
    data: { batchSize: 10 },
  });
  expect(retryRun.ok(), await retryRun.text()).toBe(true);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('2 completed');
  await expect(page.getByRole('status')).toContainText('0 failed/reviewable');
  expect(
    scenario.database.scalar(
      `select count(*) from public.integration_sync_jobs where organization_id='${scenario.ids.organization}' and roster_version_id='${scenario.ids.finalRoster}'`,
    ),
  ).toBe('1');
  expect(
    scenario.database.scalar(
      `select count(*)::text||':'||count(distinct internal_entity_id)::text||':'||count(distinct external_id)::text||':'||count(distinct first_sync_job_id)::text from public.external_entity_mappings where organization_id='${scenario.ids.organization}' and entity_type='athlete'`,
    ),
  ).toBe('2:2:2:1');
  monitor.assertClean();
});
