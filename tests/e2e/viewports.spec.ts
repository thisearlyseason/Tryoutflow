import type { Page } from '@playwright/test';

import { signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import { expectCancellableServerAction, monitorBrowserErrors } from './helpers/network';

const viewportMatrix = [
  { name: 'phone 375', width: 375, height: 812 },
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'phone 430', width: 430, height: 932 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'large desktop', width: 1920, height: 1080 },
] as const;

async function expectOverflowFreeAtEveryViewport(page: Page, screen: string) {
  for (const viewport of viewportMatrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, `${screen} overflowed at ${viewport.name}`).toBeLessThanOrEqual(
      clientWidth,
    );
  }
}

async function createDraftForWizard(page: Page, organizationSlug: string, name: string) {
  await page.goto(`/app/${organizationSlug}/tryouts/new`);
  await page.getByLabel('Tryout name').fill(name);
  await page.getByLabel('Sport').fill('Hockey');
  await page.getByLabel('New cycle name').fill(`${name} cycle`);
  await page.getByLabel('Timezone').fill('America/Edmonton');
  await page.getByLabel('Registration opens').fill('2026-09-01T08:00');
  await page.getByLabel('Registration closes').fill('2026-09-30T20:00');
}

async function prepareIntegrationReview(
  page: Page,
  organizationSlug: string,
  tryoutId: string,
  rosterVersionId: string,
) {
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

test('registration and sign-in stay overflow-free from 375px through large desktop', async ({
  page,
  scenario,
}) => {
  const monitor = monitorBrowserErrors(page);
  await page.setExtraHTTPHeaders({ 'x-vercel-forwarded-for': scenario.publicClientAddress });
  await page.goto(`/register/${scenario.organizationSlug}-critical-flow`);
  await expect(
    page.getByRole('heading', { name: `Register for ${scenario.tryoutName}` }),
  ).toBeVisible();
  await expectOverflowFreeAtEveryViewport(page, 'registration');

  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in to your organization' })).toBeVisible();
  await expectOverflowFreeAtEveryViewport(page, 'sign-in');
  monitor.assertClean();
});

test('tryout wizard, check-in, and mobile evaluation stay overflow-free across the viewport matrix', async ({
  baseURL,
  browser,
  page,
  scenario,
}) => {
  const ownerMonitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const draftName = `Task 31 viewport ${scenario.key}`;
  await createDraftForWizard(page, scenario.organizationSlug, draftName);
  expectCancellableServerAction(ownerMonitor, page, 'Task 31 viewport draft creation redirect');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/setup\/basics$/u);
  await expectOverflowFreeAtEveryViewport(page, 'tryout wizard');
  ownerMonitor.assertClean();

  const checkinContext = await browser.newContext({ baseURL });
  const checkinPage = await checkinContext.newPage();
  try {
    const checkinMonitor = await signInAs(
      checkinPage,
      scenario.users.checkin,
      scenario.organizationSlug,
    );
    await checkinPage.goto(
      `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/check-in`,
    );
    await expectOverflowFreeAtEveryViewport(checkinPage, 'check-in');
    checkinMonitor.assertClean();
  } finally {
    await checkinContext.close();
  }

  const evaluationContext = await browser.newContext({ baseURL });
  const evaluationPage = await evaluationContext.newPage();
  try {
    const evaluationMonitor = await signInAs(
      evaluationPage,
      scenario.users.evaluatorThree,
      scenario.organizationSlug,
    );
    await evaluationPage.goto(
      `/app/${scenario.organizationSlug}/evaluate/session/${scenario.ids.session}/athletes/${scenario.ids.registrationD}`,
    );
    await expectOverflowFreeAtEveryViewport(evaluationPage, 'mobile evaluation');
    await evaluationPage.setViewportSize({ width: 375, height: 812 });
    await expect(evaluationPage.getByRole('button', { name: 'Save now' })).toBeInViewport();
    await expect(
      evaluationPage.getByRole('button', { name: 'Complete evaluation' }),
    ).toBeInViewport();
    evaluationMonitor.assertClean();
  } finally {
    await evaluationContext.close();
  }
});

test('rankings, roster, and messages reflow without document overflow at every required viewport', async ({
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.director, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`);
  await expectOverflowFreeAtEveryViewport(page, 'rankings');

  await page.goto(
    `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters?division=${scenario.ids.rosterDivision}`,
  );
  await expectOverflowFreeAtEveryViewport(page, 'roster');

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/messages`);
  await expectOverflowFreeAtEveryViewport(page, 'messages');
  monitor.assertClean();
});

test('billing and integration review stay overflow-free across phone, tablet, and desktop widths', async ({
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/organization/billing`);
  await expectOverflowFreeAtEveryViewport(page, 'billing');

  await page.goto(`/app/${scenario.organizationSlug}/organization/integrations`);
  expectCancellableServerAction(monitor, page, 'Task 31 viewport provider connection redirect');
  await prepareIntegrationReview(
    page,
    scenario.organizationSlug,
    scenario.ids.tryout,
    scenario.ids.finalRoster,
  );
  await expectOverflowFreeAtEveryViewport(page, 'integration review');
  monitor.assertClean();
});
