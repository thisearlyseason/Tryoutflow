import type { Page, Request } from '@playwright/test';

import { expectNoCriticalAccessibilityViolations } from './helpers/accessibility';
import { signInAs } from './helpers/auth';
import { monitorAutomaticPrefetch } from './helpers/automatic-prefetch';
import { expect, test } from './helpers/fixtures';
import {
  expectCancellableServerAction,
  monitorBrowserErrors,
  type BrowserErrorMonitor,
} from './helpers/network';

async function auditHeading(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { name }).first()).toBeVisible();
  await expectNoCriticalAccessibilityViolations(page);
}

async function createDraftForWizard(page: Page, organizationSlug: string, name: string) {
  await page.goto(`/app/${organizationSlug}/tryouts/new`);
  await page.getByLabel('Tryout name').fill(name);
  await page.getByLabel('Sport').fill('Hockey');
  await page.getByLabel('Use an existing cycle').selectOption('');
  await page.getByLabel('New cycle name').fill(`${name} cycle`);
  await page.getByLabel('Timezone').fill('America/Edmonton');
  await page.getByLabel('Registration opens').fill('2026-09-01T08:00');
  await page.getByLabel('Registration closes').fill('2026-09-30T20:00');
}

async function openIntegrationReview(
  page: Page,
  organizationSlug: string,
  tryoutId: string,
  rosterVersionId: string,
  monitor: BrowserErrorMonitor,
) {
  await page.goto(`/app/${organizationSlug}/organization/integrations`);
  expectCancellableServerAction(monitor, page, 'Task 31 demo provider connection redirect');
  await page.getByRole('button', { name: 'Connect demo provider' }).click();
  await expect(page.getByText(/demo\/mock connection is ready/i)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/${organizationSlug}/tryouts/${tryoutId}/rosters/${rosterVersionId}/export`);
  await page.getByLabel('External destination').selectOption('mock-team-blue');
  await page.getByLabel('First name').check();
  await page.getByLabel('Last name').check();
  await page.getByLabel('Team name').check();
  expectCancellableServerAction(monitor, page, 'Task 31 roster export preview action');
  await page.getByRole('button', { name: 'Preview export' }).click();
  await expect(page.getByRole('heading', { name: 'Review 2 athletes' })).toBeVisible();
}

test('registration and sign-in expose critical-screen semantics without critical axe violations', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=anonymous; organization=${scenario.organizationSlug}; screens=registration,sign-in`,
  });
  const monitor = monitorBrowserErrors(page);
  const automaticPrefetch = monitorAutomaticPrefetch(page);
  try {
    await page.setExtraHTTPHeaders({ 'x-vercel-forwarded-for': scenario.publicClientAddress });
    const registration = await page.goto(`/register/${scenario.organizationSlug}-critical-flow`);
    expect(registration?.ok(), 'registration document loads successfully').toBe(true);
    await auditHeading(page, `Register for ${scenario.tryoutName}`);
    await expect(page.getByLabel('Guardian email')).toHaveAttribute('autocomplete', 'email');
    automaticPrefetch.assertNone();

    const signIn = await page.goto('/sign-in');
    expect(signIn?.ok(), 'sign-in document loads successfully').toBe(true);
    await auditHeading(page, 'Sign in to your account');
    await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByLabel('Password').and(page.locator('input'))).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    automaticPrefetch.assertNone();
    monitor.assertClean();
  } finally {
    automaticPrefetch.stop();
    monitor.stop();
  }
});

test('tryout wizard preserves native labels and critical accessibility semantics', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=owner; organization=${scenario.organizationSlug}; screen=tryout-wizard`,
  });
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const automaticPrefetch = monitorAutomaticPrefetch(page);
  const setupBase = new URL(`/app/${scenario.organizationSlug}/tryouts/`, page.url()).href;
  const escapedBase = setupBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const setupNavigation = new RegExp(
    `^${escapedBase}[0-9a-f-]{36}/setup/(?:divisions|basics)\\?_rsc=[^&#]+$`,
    'u',
  );
  const failedRequests: Request[] = [];
  const captureFailure = (request: Request) => failedRequests.push(request);
  page.on('requestfailed', captureFailure);
  // Chromium can cancel an already-consumed navigation stream after rendering it.
  // Bound this to one non-prefetch GET per setup destination in this owned scenario.
  for (const step of ['divisions', 'basics']) {
    monitor.allowOptionalRequestFailure({
      method: 'GET',
      url: new RegExp(`^${escapedBase}[0-9a-f-]{36}/setup/${step}\\?_rsc=[^&#]+$`, 'u'),
      headers: {
        rsc: '1',
        'next-router-prefetch': /^$/u,
        'next-router-segment-prefetch': /^$/u,
      },
      errorText: 'net::ERR_ABORTED',
      maxCount: 1,
      label: `Consumed wizard ${step} navigation stream`,
    });
  }
  try {
    const name = `Task 31 wizard ${scenario.key}`;
    await createDraftForWizard(page, scenario.organizationSlug, name);
    expectCancellableServerAction(monitor, page, 'Task 31 draft creation redirect');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/setup\/divisions$/u);
    await page
      .getByRole('navigation', { name: 'Tryout setup progress' })
      .getByRole('link', { name: 'Tryout details', exact: true })
      .click();
    await auditHeading(page, 'Tryout basics');
    await expect(page.getByLabel('Name')).toHaveValue(name);
    automaticPrefetch.assertNone();
    for (const request of failedRequests) {
      if (request.method() === 'GET' && setupNavigation.test(request.url())) {
        expect(
          (await request.response())?.status(),
          'Only a setup stream that returned HTTP 200 may be cancelled after rendering',
        ).toBe(200);
      }
    }
    monitor.assertClean();
  } finally {
    page.off('requestfailed', captureFailure);
    automaticPrefetch.stop();
    monitor.stop();
  }
});

test('check-in and mobile evaluation expose semantic controls without critical axe violations', async ({
  baseURL,
  browser,
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `roles=checkin,evaluator-three; organization=${scenario.organizationSlug}; screens=check-in,mobile-evaluation`,
  });
  const checkinMonitor = await signInAs(page, scenario.users.checkin, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/check-in`);
  await auditHeading(page, `${scenario.tryoutName} check-in`);
  await expect(page.getByRole('status')).toHaveText('Search for a registration to begin.');
  checkinMonitor.assertClean();

  const context = await browser.newContext({
    baseURL,
    locale: 'en-CA',
    timezoneId: 'America/Edmonton',
    viewport: { width: 375, height: 812 },
  });
  const evaluationPage = await context.newPage();
  try {
    const evaluationMonitor = await signInAs(
      evaluationPage,
      scenario.users.evaluatorThree,
      scenario.organizationSlug,
    );
    await evaluationPage.goto(
      `/app/${scenario.organizationSlug}/evaluate/session/${scenario.ids.session}/athletes/${scenario.ids.registrationD}`,
    );
    await auditHeading(evaluationPage, 'Offline Rinkside');
    await expect(
      evaluationPage.getByRole('radio', { name: 'Control score 2 of 10' }),
    ).toBeVisible();
    evaluationMonitor.assertClean();
  } finally {
    await context.close();
  }
});

test('rankings and roster expose semantic filters, alternatives, and dialog focus restoration', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=director; organization=${scenario.organizationSlug}; screens=rankings,roster`,
  });
  const monitor = await signInAs(page, scenario.users.director, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`);
  await auditHeading(page, 'Rankings');
  await expect(page.getByLabel('Search athletes')).toBeVisible();

  await page.goto(
    `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters?division=${scenario.ids.rosterDivision}`,
  );
  await auditHeading(page, `${scenario.tryoutName} official rosters`);
  const select = page.getByLabel('Select Roster Mover');
  const move = page.getByRole('button', { name: 'Move Roster Mover' });
  const forwardTab =
    testInfo.project.name === 'webkit' || testInfo.project.name === 'Mobile Safari'
      ? 'Alt+Tab'
      : 'Tab';
  const backwardTab =
    testInfo.project.name === 'webkit' || testInfo.project.name === 'Mobile Safari'
      ? 'Alt+Shift+Tab'
      : 'Shift+Tab';
  await select.focus();
  await expect(select).toBeFocused();
  await page.keyboard.press(forwardTab);
  await expect(move).toBeFocused();
  await page.keyboard.press(backwardTab);
  await expect(select).toBeFocused();
  await page.keyboard.press(forwardTab);
  await expect(move).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Move Roster Mover' })).toBeVisible();
  await expect(page.getByLabel('Destination team')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(move).toBeFocused();
  monitor.assertClean();
});

test('messages and billing expose live statuses and critical accessibility semantics', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `roles=director,owner; organization=${scenario.organizationSlug}; screens=messages,billing`,
  });
  const directorMonitor = await signInAs(page, scenario.users.director, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/messages`);
  await auditHeading(page, 'Messages');
  await expect(page.getByRole('status')).toBeAttached();
  directorMonitor.assertClean();
  directorMonitor.stop();

  await page.context().clearCookies();
  const ownerMonitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/organization/billing`);
  await auditHeading(page, 'Billing');
  await expect(page.getByRole('status')).toContainText('Trial active');
  ownerMonitor.assertClean();
});

test('integration review exposes explicit field approval without critical axe violations', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=owner; organization=${scenario.organizationSlug}; screen=integration-review; provider=The Squad demo/mock`,
  });
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  await openIntegrationReview(
    page,
    scenario.organizationSlug,
    scenario.ids.tryout,
    scenario.ids.finalRoster,
    monitor,
  );
  await auditHeading(page, 'Review 2 athletes');
  await expect(page.getByLabel('I reviewed the exact destination and fields')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Confirm and queue export' })).toBeDisabled();
  monitor.assertClean();
});
