import { signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import {
  expectCancellableServerAction,
  holdResponseAfterApplicationCommit,
  reconnect,
  setOffline,
} from './helpers/network';

test('offline evaluation saves locally, reconnects once, and survives refresh', async ({
  context,
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.evaluatorThree, scenario.organizationSlug);
  await page.goto(
    `/app/${scenario.organizationSlug}/evaluate/session/${scenario.ids.session}/athletes/${scenario.ids.registrationD}`,
  );
  let mutations = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      /\/api\/evaluations\/[^/]+\/mutations$/u.test(request.url())
    ) {
      mutations += 1;
    }
  });

  await setOffline(context);
  await page.getByRole('radio', { name: 'Control score 2 of 10' }).click();
  await page.getByRole('radio', { name: 'Finish score 10 of 10' }).click();
  await page.getByLabel('Private evaluator note').fill('Task 31 durable offline note');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on device');
  expect(mutations).toBe(0);

  const synchronized = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/evaluations\/[^/]+\/mutations$/u.test(response.url()),
  );
  await reconnect(context, page);
  expect((await synchronized).ok()).toBe(true);
  await expect(page.getByText('Saved on server', { exact: true })).toBeVisible();
  expect(mutations).toBe(1);
  await page.reload();
  await expect(page.getByLabel('Private evaluator note')).toHaveValue(
    'Task 31 durable offline note',
  );
  monitor.assertClean();
});

test('slow check-in search announces loading, disables repeat submission, and recovers', async ({
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.checkin, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/check-in`);
  const status = page.getByRole('status');
  const searchRegion = page.getByRole('search', { name: 'Registration search' });
  const delayedSearch = await holdResponseAfterApplicationCommit(
    page,
    (request) =>
      request.method() === 'POST' &&
      request.url() === page.url() &&
      typeof request.headers()['next-action'] === 'string',
  );
  try {
    await page.getByLabel('Search registrations').fill('Exact');
    await page.getByRole('button', { name: 'Search' }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await delayedSearch.requested;
    expect(delayedSearch.matchingRequestCount(), 'one initiating search Server Action').toBe(1);
    await expect(page.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    await expect(searchRegion).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveText('Searching registrations…');
    delayedSearch.release();
    await expect(page.getByRole('heading', { name: 'Exact Aggregate' })).toBeVisible();
    await expect(status).toHaveText('1 found.');
    await expect(searchRegion).toHaveAttribute('aria-busy', 'false');
    expect(delayedSearch.matchingRequestCount(), 'no later search Server Action').toBe(1);
  } finally {
    await delayedSearch.cleanup();
  }

  expect(
    scenario.database.scalar(
      `select count(*) from public.checkins where organization_id='${scenario.ids.organization}' and tryout_id='${scenario.ids.tryout}' and registration_id='${scenario.ids.registrationA}' and session_id='${scenario.ids.session}' and reversed_at is null`,
    ),
  ).toBe('0');
  await page.getByLabel('Requested number (optional)').fill('91');
  const delayedCheckin = await holdResponseAfterApplicationCommit(
    page,
    (request) =>
      request.method() === 'POST' &&
      request.url() === page.url() &&
      typeof request.headers()['next-action'] === 'string',
  );
  try {
    const checkIn = page.getByRole('button', { name: 'Check in Exact Aggregate' });
    await checkIn.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await delayedCheckin.requested;
    expect(delayedCheckin.matchingRequestCount(), 'one initiating check-in Server Action').toBe(1);
    await expect(checkIn).toBeDisabled();
    await expect(searchRegion).toHaveAttribute('aria-busy', 'false');
    await expect(status).toHaveText('Checking in Exact Aggregate…');
    delayedCheckin.release();
    await expect(status).toHaveText('Exact Aggregate checked in. #91.');
    expect(delayedCheckin.matchingRequestCount(), 'no later check-in Server Action').toBe(1);
  } finally {
    await delayedCheckin.cleanup();
  }
  expect(
    scenario.database.scalar(
      `select count(*)::text || ':' || min(assigned_number_snapshot)::text from public.checkins where organization_id='${scenario.ids.organization}' and tryout_id='${scenario.ids.tryout}' and registration_id='${scenario.ids.registrationA}' and session_id='${scenario.ids.session}' and reversed_at is null`,
    ),
  ).toBe('1:91');
  monitor.assertClean();
});

test('failed checkout reports exact recovery copy, restores focus, and double-clicks only once', async ({
  browserName,
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const checkoutUrl = `http://127.0.0.1:3112/api/organizations/${scenario.ids.organization}/billing/checkout`;
  monitor.expectRequestFailure({
    count: 1,
    errorText:
      browserName === 'chromium'
        ? 'net::ERR_FAILED'
        : browserName === 'firefox'
          ? 'NS_ERROR_FAILURE'
          : 'Blocked by Web Inspector',
    label: 'one deliberate Task 31 checkout request failure',
    method: 'POST',
    url: checkoutUrl,
  });
  if (browserName === 'chromium') {
    monitor.expectConsoleError({
      count: 1,
      label: 'Chromium diagnostic for the deliberate Task 31 checkout failure',
      text: 'Failed to load resource: net::ERR_FAILED',
      url: checkoutUrl,
    });
  }
  await page.goto(`/app/${scenario.organizationSlug}/organization/billing`);
  let attempts = 0;
  await page.route(checkoutUrl, async (route) => {
    attempts += 1;
    await route.abort('failed');
  });
  const chooseTeam = page.getByRole('button', { name: 'Choose Team' });
  await chooseTeam.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    page.getByText('Checkout could not be opened. Nothing was changed. Please try again.'),
  ).toBeVisible();
  await expect(chooseTeam).toBeEnabled();
  await expect(chooseTeam).toBeFocused();
  expect(attempts).toBe(1);

  await page.unroute(checkoutUrl);
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Stripe recovery boundary</h1>' }),
  );
  await chooseTeam.click();
  await expect(page.getByRole('heading', { name: 'Stripe recovery boundary' })).toBeVisible();
  monitor.assertClean();
});

test('integration review tolerates back, forward, and refresh without queuing or losing recovery', async ({
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/organization/integrations`);
  expectCancellableServerAction(monitor, page, 'Task 31 history provider connection redirect');
  await page.getByRole('button', { name: 'Connect demo provider' }).click();
  await expect(page.getByText(/demo\/mock connection is ready/i)).toBeVisible();
  await page.waitForLoadState('networkidle');
  const exportPath = `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters/${scenario.ids.finalRoster}/export`;
  await page.goto(exportPath);
  await page.getByLabel('External destination').selectOption('mock-team-blue');
  await page.getByLabel('First name').check();
  await page.getByLabel('Last name').check();
  await page.getByLabel('Team name').check();
  expectCancellableServerAction(monitor, page, 'Task 31 history initial export preview');
  await page.getByRole('button', { name: 'Preview export' }).click();
  await expect(page.getByRole('heading', { name: 'Review 2 athletes' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Export finalized roster' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Export finalized roster' })).toBeVisible();
  expect(
    scenario.database.scalar(
      `select count(*) from public.integration_sync_jobs where organization_id='${scenario.ids.organization}'`,
    ),
  ).toBe('0');

  await page.getByLabel('External destination').selectOption('mock-team-blue');
  await page.getByLabel('First name').check();
  expectCancellableServerAction(monitor, page, 'Task 31 history recovery export preview');
  await page.getByRole('button', { name: 'Preview export' }).click();
  await expect(page.getByRole('heading', { name: 'Review 2 athletes' })).toBeVisible();
  monitor.assertClean();
});
