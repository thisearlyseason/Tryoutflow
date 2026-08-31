import { signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import { expectNoCriticalAccessibilityViolations } from './helpers/accessibility';
import {
  expectCancellableNextRscRequest,
  expectCancellableServerAction,
  monitorBrowserErrors,
} from './helpers/network';

async function expectNoOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.locator('html').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test('anonymous and signed-in non-platform callers receive non-oracular platform denials', async ({
  browserName,
  page,
  scenario,
}) => {
  const anonymousMonitor = monitorBrowserErrors(page);
  await page.goto('/platform/health');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fplatform%2Fhealth$/u);
  anonymousMonitor.assertClean();

  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  if (browserName !== 'firefox') {
    monitor.expectConsoleError({
      count: 1,
      label: 'deliberately denied non-platform administration navigation',
      text: /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/u,
    });
  }
  const response = await page.goto('/platform/organizations');
  expect(response?.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText(scenario.organizationName);
  monitor.assertClean();
});

test('platform administrator uses responsive, accessible, privacy-safe operations and audited support', async ({
  page,
  scenario,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const monitor = await signInAs(page, scenario.users.platformAdministrator);

  await page.goto('/platform/organizations');
  await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();
  await expect(page.getByText(scenario.organizationName)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /Exact Aggregate|private evaluator note|selected-.*@example\.test/iu,
  );
  await expectNoOverflow(page);
  await expectNoCriticalAccessibilityViolations(page);

  expectCancellableNextRscRequest(
    monitor,
    new URL('/platform/subscriptions', page.url()).href,
    'platform subscription navigation RSC',
  );
  await page.getByRole('link', { name: 'Subscriptions' }).click();
  await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
  await expect(page.getByText('trial', { exact: true }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/cus_|sub_|provider payload/iu);

  expectCancellableNextRscRequest(
    monitor,
    new URL('/platform/health', page.url()).href,
    'platform health navigation RSC',
  );
  await page.getByRole('link', { name: 'System health' }).click();
  await expect(page.getByRole('definition')).toHaveCount(6);
  await expect(page.locator('body')).not.toContainText(/guardian|score|note|token/iu);

  expectCancellableNextRscRequest(
    monitor,
    new URL('/platform/support', page.url()).href,
    'platform support navigation RSC',
  );
  await page.getByRole('link', { name: 'Support' }).click();
  await page.getByLabel('Organization').selectOption(scenario.ids.organization);
  await page.getByLabel('Bounded support reason').fill('Investigate support ticket T32-E2E');
  await page.getByLabel('Duration').selectOption('30');
  expectCancellableServerAction(monitor, page, 'audited platform support elevation redirect');
  await page.getByRole('button', { name: 'Begin audited support elevation' }).click();
  await expect(page.getByRole('status')).toContainText('audit evidence recorded');
  const currentElevation = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: scenario.organizationSlug }) });
  await expect(currentElevation.getByText('Investigate support ticket T32-E2E')).toBeVisible();
  expect(
    scenario.database.scalar(
      `select count(*)::text||':'||(select count(*) from public.audit_logs where organization_id='${scenario.ids.organization}' and action='platform.support_elevation.started')::text from public.platform_support_elevations where organization_id='${scenario.ids.organization}' and support_user_id='${scenario.users.platformAdministrator.id}'`,
    ),
  ).toBe('1:1');
  await expectNoOverflow(page);
  await expectNoCriticalAccessibilityViolations(page);
  monitor.assertClean();
});

test('organization owner can read safe audit history while a member cannot', async ({
  browser,
  baseURL,
  browserName,
  page,
  scenario,
}) => {
  const ownerMonitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  await page.goto(`/app/${scenario.organizationSlug}/organization/audit`);
  await expect(page.getByRole('heading', { name: 'Organization audit' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /private evaluator note|selected-.*@example\.test/iu,
  );
  ownerMonitor.assertClean();

  const { openAuthenticatedContext } = await import('./helpers/auth');
  const member = await openAuthenticatedContext({
    browser,
    baseURL: baseURL!,
    user: scenario.users.member,
    organizationSlug: scenario.organizationSlug,
  });
  try {
    if (browserName !== 'firefox') {
      member.monitor.expectConsoleError({
        count: 1,
        label: 'deliberately denied organization audit navigation',
        text: /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/u,
      });
    }
    expect(
      (await member.page.goto(`/app/${scenario.organizationSlug}/organization/audit`))?.status(),
    ).toBe(404);
    await expect(member.page.locator('body')).not.toContainText(scenario.organizationName);
    member.monitor.assertClean();
  } finally {
    await member.context.close();
  }
});
