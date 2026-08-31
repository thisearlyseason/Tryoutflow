import { openAuthenticatedContext, signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import { monitorBrowserErrors } from './helpers/network';

test('scenario 6 — other-tenant owner is denied a direct organization and tryout URL without an existence oracle', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=owner of ${scenario.otherOrganizationSlug}; deniedOrganization=${scenario.organizationSlug}; deniedTryout=${scenario.tryoutName} (${scenario.ids.tryout})`,
  });
  const monitor = monitorBrowserErrors(page);
  monitor.allowConsoleError(
    /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/u,
  );
  await signInAs(page, scenario.users.otherOwner, scenario.otherOrganizationSlug);

  const response = await page.goto(
    `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/overview`,
  );
  expect(response?.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText(scenario.organizationName);
  await expect(page.locator('body')).not.toContainText(scenario.tryoutName);
  await expect(page.locator('body')).not.toContainText(/Exact Aggregate|Final Selected/u);

  const report = await page.goto(
    `/api/organizations/${scenario.ids.organization}/exports/athletes?tryoutId=${scenario.ids.tryout}`,
  );
  expect(report?.status()).toBe(404);
  await expect(page.locator('body')).toHaveText('Export not found.');
  monitor.assertClean();
});

test('scenario 7 — check-in staff, evaluator, reviewer, member, and anonymous direct URLs retain exact role denials', async ({
  baseURL,
  browser,
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `roles=checkin/evaluator/reviewer/member/anonymous; organization=${scenario.organizationSlug}; tryout=${scenario.tryoutName} (${scenario.ids.tryout})`,
  });
  const openActor = (user: typeof scenario.users.checkin) =>
    openAuthenticatedContext({
      browser,
      baseURL: baseURL!,
      user,
      organizationSlug: scenario.organizationSlug,
    });
  const expected404 =
    /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/u;

  const checkin = await openActor(scenario.users.checkin);
  try {
    const monitor = monitorBrowserErrors(checkin.page);
    monitor.allowConsoleError(expected404);
    await checkin.page.goto(
      `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`,
    );
    await expect(
      checkin.page.getByRole('heading', { name: 'Rankings access denied' }),
    ).toBeVisible();
    await expect(checkin.page.locator('body')).not.toContainText(/84\.0000|private|guardian/iu);
    expect(
      (
        await checkin.page.goto(
          `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters?division=${scenario.ids.rosterDivision}`,
        )
      )?.status(),
    ).toBe(404);
    monitor.assertClean();
  } finally {
    await checkin.context.close();
  }

  const evaluator = await openActor(scenario.users.evaluatorOne);
  try {
    const monitor = monitorBrowserErrors(evaluator.page);
    monitor.allowConsoleError(expected404);
    await evaluator.page.goto(
      `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`,
    );
    await expect(
      evaluator.page.getByRole('heading', { name: 'Rankings access denied' }),
    ).toBeVisible();
    await expect(evaluator.page.locator('body')).not.toContainText(
      /Tie Alpha|Tie Beta|peer|private/iu,
    );
    const evaluatorReport = await evaluator.page.goto(
      `/api/organizations/${scenario.ids.organization}/exports/evaluations?tryoutId=${scenario.ids.tryout}`,
    );
    expect(evaluatorReport?.status()).toBe(404);
    monitor.assertClean();
  } finally {
    await evaluator.context.close();
  }

  const reviewer = await openActor(scenario.users.reviewer);
  try {
    const monitor = monitorBrowserErrors(reviewer.page);
    expect(
      (
        await reviewer.page.goto(
          `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`,
        )
      )?.status(),
    ).toBe(200);
    await expect(
      reviewer.page.getByRole('heading', { name: 'Rankings access denied' }),
    ).toBeVisible();
    await reviewer.page.goto(
      `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/reports`,
    );
    await expect(
      reviewer.page.getByRole('link', { name: 'Download finalized roster CSV' }),
    ).toBeVisible();
    await expect(reviewer.page.getByRole('link', { name: 'Download athletes CSV' })).toHaveCount(0);
    await expect(reviewer.page.getByRole('link', { name: 'Download evaluations CSV' })).toHaveCount(
      0,
    );
    monitor.assertClean();
  } finally {
    await reviewer.context.close();
  }

  const member = await openActor(scenario.users.member);
  try {
    const monitor = monitorBrowserErrors(member.page);
    monitor.allowConsoleError(expected404);
    expect(
      (
        await member.page.goto(
          `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/check-in`,
        )
      )?.status(),
    ).toBe(404);
    monitor.assertClean();
  } finally {
    await member.context.close();
  }

  const monitor = monitorBrowserErrors(page);
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/reports`);
  await expect(page).toHaveURL(/\/sign-in\?next=/u);
  monitor.assertClean();
});
