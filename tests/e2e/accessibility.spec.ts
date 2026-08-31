import type { Page } from '@playwright/test';

import { expectNoCriticalAccessibilityViolations } from './helpers/accessibility';
import { signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import { expectCancellableServerAction, monitorBrowserErrors } from './helpers/network';

async function auditHeading(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { name }).first()).toBeVisible();
  await expectNoCriticalAccessibilityViolations(page);
}

async function createDraftForWizard(page: Page, organizationSlug: string, name: string) {
  await page.goto(`/app/${organizationSlug}/tryouts/new`);
  await page.getByLabel('Tryout name').fill(name);
  await page.getByLabel('Sport').fill('Hockey');
  await page.getByLabel('Timezone').fill('America/Edmonton');
  await page.getByLabel('Registration opens').fill('2026-09-01T08:00');
  await page.getByLabel('Registration closes').fill('2026-09-30T20:00');
}

async function openIntegrationReview(
  page: Page,
  organizationSlug: string,
  tryoutId: string,
  rosterVersionId: string,
) {
  await page.goto(`/app/${organizationSlug}/organization/integrations`);
  await page.getByRole('button', { name: 'Connect demo provider' }).click();
  await expect(page.getByText(/demo\/mock connection is ready/i)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/${organizationSlug}/tryouts/${tryoutId}/rosters/${rosterVersionId}/export`);
  await page.getByLabel('External destination').selectOption('mock-team-blue');
  await page.getByLabel('First name').check();
  await page.getByLabel('Last name').check();
  await page.getByLabel('Team name').check();
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
  await page.setExtraHTTPHeaders({ 'x-vercel-forwarded-for': scenario.publicClientAddress });
  await page.goto(`/register/${scenario.organizationSlug}-critical-flow`);
  await auditHeading(page, `Register for ${scenario.tryoutName}`);
  await expect(page.getByLabel('Guardian email')).toHaveAttribute('autocomplete', 'email');

  await page.goto('/sign-in');
  await auditHeading(page, 'Sign in to your organization');
  await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  monitor.assertClean();
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
  const name = `Task 31 wizard ${scenario.key}`;
  await createDraftForWizard(page, scenario.organizationSlug, name);
  expectCancellableServerAction(monitor, page, 'Task 31 draft creation redirect');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/setup\/basics$/u);
  await auditHeading(page, 'Tryout basics');
  await expect(page.getByLabel('Name')).toHaveValue(name);
  monitor.assertClean();
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
  await auditHeading(page, `${scenario.tryoutName} rosters`);
  const move = page.getByRole('button', { name: 'Move Roster Mover' });
  await move.focus();
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
  await page.goto(`/app/${scenario.organizationSlug}/organization/integrations`);
  expectCancellableServerAction(monitor, page, 'Task 31 demo provider connection redirect');
  await openIntegrationReview(
    page,
    scenario.organizationSlug,
    scenario.ids.tryout,
    scenario.ids.finalRoster,
  );
  await auditHeading(page, 'Review 2 athletes');
  await expect(page.getByLabel('I reviewed the exact destination and fields')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Confirm and queue export' })).toBeDisabled();
  monitor.assertClean();
});
