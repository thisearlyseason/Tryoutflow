import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import {
  expectCancellableImageRequest,
  expectCancellableNextRscRequest,
  expectCancellableServerAction,
  monitorBrowserErrors,
} from './helpers/network';

const logoFixture = resolve('tests/fixtures/branding/organization-logo.png');

async function expectNoHorizontalOverflow(page: Page, label: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      { message: `${label} has no horizontal document overflow` },
    )
    .toBe(true);
}

test('isolated owner completes the branded tryout journey and removes the logo cleanly', async ({
  baseURL,
  brandedJourney: scenario,
  browser,
  page,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=owner; organization=${scenario.organizationSlug}; authored tryout=complete branded journey; operational fixture=${scenario.tryoutName} (${scenario.ids.tryout})`,
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  const ownerMonitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const settingsPath = `/app/${scenario.organizationSlug}/organization/settings`;

  await page.goto(settingsPath);
  await page.getByLabel('Choose logo').setInputFiles(logoFixture);
  expectCancellableServerAction(ownerMonitor, page, 'initial organization logo upload redirect');
  await page.getByRole('button', { name: 'Upload logo' }).click();
  await expect(page.getByRole('status')).toHaveText('Organization logo updated.');
  await expect(
    page.locator('.app-sidebar .app-organization').getByRole('img', {
      name: `${scenario.organizationName} logo`,
    }),
  ).toBeVisible();
  expect(
    (await page.request.get(`/api/organizations/${scenario.organizationSlug}/logo`)).status(),
  ).toBe(200);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.locator('.mobile-navigation .mobile-organization').getByRole('img', {
      name: `${scenario.organizationName} logo`,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page, 'mobile organization settings');

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/app/${scenario.organizationSlug}/tryouts/new`);
  await expect(page.getByLabel('Tryout name')).toHaveAttribute(
    'placeholder',
    'U15 Fall Evaluations',
  );
  await expect(page.getByLabel('New cycle name')).toHaveAttribute(
    'placeholder',
    '2026 Fall Season',
  );
  const suffix = scenario.key.slice(-8);
  const tryoutName = `U15 Fall Evaluations ${suffix}`;
  const cycleName = `2026 Fall Season ${suffix}`;
  await page.getByLabel('Tryout name').fill(tryoutName);
  await page.getByLabel('Sport').fill('Hockey');
  await page.getByLabel('New cycle name').fill(cycleName);
  await page.getByLabel('Timezone').fill('America/Edmonton');
  await page.getByLabel('Registration opens').fill('2026-09-01T08:00');
  await page.getByLabel('Registration closes').fill('2026-09-30T20:00');
  expectCancellableServerAction(ownerMonitor, page, 'cycle-backed draft creation redirect');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/tryouts\/[0-9a-f-]+\/setup\/basics$/u);
  const authoredTryoutId = /\/tryouts\/([0-9a-f-]+)\/setup\/basics$/u.exec(page.url())?.[1];
  expect(authoredTryoutId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );

  await expect(page.getByLabel('Tryout name')).toHaveValue(tryoutName);
  await expect(page.getByLabel('Sport')).toHaveValue('Hockey');
  await expect(page.getByLabel('Timezone')).toHaveValue('America/Edmonton');
  await expect(page.getByLabel('Registration opens')).toHaveValue('2026-09-01T08:00');
  await expect(page.getByLabel('Registration closes')).toHaveValue('2026-09-30T20:00');
  await page.reload();
  await expect(page.getByLabel('Tryout name')).toHaveValue(tryoutName);
  await expect(page.getByLabel('Registration closes')).toHaveValue('2026-09-30T20:00');
  expectCancellableServerAction(ownerMonitor, page, 'guided basics persistence redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByLabel('Division name')).toHaveAttribute('placeholder', 'U15');
  await page.getByLabel('Division name').fill('U15');
  expectCancellableServerAction(ownerMonitor, page, 'guided division persistence redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByLabel('Session name')).toHaveAttribute('placeholder', 'Skills Session 1');
  await expect(page.getByLabel('Group (optional)')).toHaveAttribute('placeholder', 'Forward Group');
  await expect(page.getByLabel('Position (optional)')).toHaveAttribute('placeholder', 'Forward');
  await expect(page.getByLabel('Group (optional)')).toHaveValue('');
  await expect(page.getByLabel('Position (optional)')).toHaveValue('');
  await page.getByLabel('Division').selectOption({ label: 'U15' });
  await page.getByLabel('Session name').fill('Skills Session 1');
  await page.getByLabel('Starts').fill('2026-10-01T16:00');
  await page.getByLabel('Ends').fill('2026-10-01T18:00');
  expectCancellableServerAction(ownerMonitor, page, 'guided session persistence redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByLabel('Form name')).toHaveAttribute(
    'placeholder',
    '2026 Player Registration',
  );
  await page.getByLabel('Form name').fill('2026 Player Registration');
  expectCancellableServerAction(
    ownerMonitor,
    page,
    'guided registration form persistence redirect',
  );
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByLabel('Rubric name')).toHaveAttribute(
    'placeholder',
    'Skating and Game Sense',
  );
  await page.getByLabel('Session').selectOption({ label: 'Skills Session 1' });
  await page.getByLabel('Rubric name').fill('Skating and Game Sense');
  await page.getByLabel('Category name').fill('Skating');
  expectCancellableServerAction(ownerMonitor, page, 'guided rubric persistence redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Review setup' })).toBeVisible();
  await expect(page.getByText('Publishing is blocked')).toHaveCount(0);
  expectCancellableServerAction(ownerMonitor, page, 'guided review redirect');
  await page.getByRole('button', { name: 'Ready to publish' }).click();
  await page.getByLabel(`Type “${tryoutName}” to publish`).fill(tryoutName);
  expectCancellableServerAction(ownerMonitor, page, 'guided publication redirect');
  await page.getByRole('button', { name: 'Publish tryout' }).click();
  await expect(page.getByRole('heading', { name: tryoutName })).toBeVisible();
  await expect(page.getByText('published', { exact: true })).toBeVisible();
  const publicHref = await page
    .getByRole('link', { name: 'Open public registration' })
    .getAttribute('href');
  expect(publicHref).toBeTruthy();
  const publicPath = new URL(publicHref!, String(baseURL)).pathname;
  const publicSlug = publicPath.split('/').at(-1)!;
  scenario.database.trackRegistrationRateTarget(publicSlug);
  expect(
    scenario.database.scalar(
      `select season.name||'|'||tryout.season_id::text||'|'||(select count(*) from public.session_groups grouping where grouping.organization_id=tryout.organization_id and grouping.tryout_id=tryout.id)::text||'|'||(select count(*) from public.tryout_positions position where position.organization_id=tryout.organization_id and position.tryout_id=tryout.id)::text from public.tryouts tryout join public.seasons season on season.id=tryout.season_id and season.organization_id=tryout.organization_id where tryout.organization_id='${scenario.ids.organization}' and tryout.id='${authoredTryoutId}'`,
    ),
  ).toMatch(
    new RegExp(`^${cycleName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\|[0-9a-f-]+\\|0\\|0$`, 'u'),
  );

  const publicContext = await browser.newContext({
    baseURL: String(baseURL),
    locale: 'en-CA',
    timezoneId: 'America/Edmonton',
    viewport: { width: 320, height: 844 },
    extraHTTPHeaders: { 'x-vercel-forwarded-for': scenario.publicClientAddress },
  });
  const publicPage = await publicContext.newPage();
  const publicMonitor = monitorBrowserErrors(publicPage);
  const familyName = `Journey-${suffix}`;
  try {
    await publicPage.goto(publicPath);
    await expect(publicPage.getByText(scenario.organizationName, { exact: true })).toBeVisible();
    await expect(
      publicPage.getByRole('img', { name: `${scenario.organizationName} logo` }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole('heading', { name: `Register for ${tryoutName}` }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(publicPage, '320px branded public registration');
    await publicPage.getByLabel('Athlete first name').fill('Jordan');
    await publicPage.getByLabel('Athlete last name').fill(familyName);
    await publicPage.getByLabel('Date of birth').fill('2012-09-15');
    await publicPage.getByLabel('Guardian name').fill('Taylor Lee');
    await publicPage.getByLabel('Guardian email').fill(`guardian-${suffix}@example.test`);
    const submitted = publicPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/public/registrations'),
    );
    await publicPage.getByRole('button', { name: 'Submit registration' }).click();
    expect((await submitted).status()).toBe(200);
    await expect(publicPage).toHaveURL(new RegExp(`/register/${publicSlug}/confirmation$`, 'u'));
    publicMonitor.assertClean();
  } finally {
    publicMonitor.stop();
    await publicContext.close();
  }

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/registration`);
  await expect(page.getByRole('heading', { name: 'Recent registrations' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: `Jordan ${familyName}` }),
  ).toBeVisible();

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/overview`);
  await expect(page.getByRole('heading', { name: 'Tryout journey' })).toBeVisible();
  const runStage = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Run tryout' }),
  });
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/check-in`,
    'journey check-in navigation RSC request',
  );
  await runStage.locator('a[href$="/check-in"]').click();
  await expect(
    page.getByRole('heading', { name: `${scenario.tryoutName} check-in` }),
  ).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/live`,
    'check-in to live navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Open live dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Live dashboard' })).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rankings`,
    'live to rankings navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Review rankings' }).click();
  await expect(page.getByRole('heading', { name: 'Rankings' })).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters`,
    'rankings to rosters navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Build rosters' }).click();
  await expect(page.getByRole('heading', { name: `${scenario.tryoutName} rosters` })).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/messages`,
    'rosters to messages navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Review communication' }).click();
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/reports`,
    'messages to reports navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Review reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();

  const evaluationContext = await browser.newContext({
    baseURL: String(baseURL),
    locale: 'en-CA',
    timezoneId: 'America/Edmonton',
  });
  const evaluationPage = await evaluationContext.newPage();
  try {
    const evaluationMonitor = monitorBrowserErrors(evaluationPage);
    const logoVersion = scenario.database.scalar(
      `select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'+00:00' from private.organization_brand_assets where organization_id='${scenario.ids.organization}'`,
    );
    if (testInfo.project.name === 'firefox') {
      expectCancellableImageRequest(
        evaluationMonitor,
        `${baseURL}/api/organizations/${scenario.organizationSlug}/logo?v=${encodeURIComponent(logoVersion)}`,
        'two versioned evaluator shell logo requests in Firefox responsive chrome',
        2,
      );
    }
    await signInAs(
      evaluationPage,
      scenario.users.evaluatorOne,
      scenario.organizationSlug,
      evaluationMonitor,
    );
    const evaluatorLogo = evaluationPage.getByRole('img', {
      name: `${scenario.organizationName} logo`,
    });
    await expect(evaluatorLogo).toBeVisible();
    await expect
      .poll(() =>
        evaluatorLogo.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        ),
      )
      .toBe(true);
    expectCancellableNextRscRequest(
      evaluationMonitor,
      `${baseURL}/app/${scenario.organizationSlug}/evaluate`,
      'evaluator workspace navigation RSC request',
    );
    await evaluationPage.getByRole('link', { name: 'Evaluate' }).click();
    await expect(
      evaluationPage.getByRole('heading', { name: 'Your assigned sessions' }),
    ).toBeVisible();
    await evaluationPage.waitForLoadState('networkidle');
    expectCancellableNextRscRequest(
      evaluationMonitor,
      `${baseURL}/app/${scenario.organizationSlug}/evaluate/session/${scenario.ids.session}`,
      'scoring session navigation RSC request',
    );
    await evaluationPage.getByRole('link', { name: 'Open scoring session' }).click();
    await expect(
      evaluationPage.getByRole('heading', { name: 'Task 30 Exact Scoring' }),
    ).toBeVisible();
    await evaluationPage.waitForLoadState('networkidle');
    await evaluationPage.getByRole('link', { name: 'Assigned athletes' }).click();
    await expect(evaluationPage.getByRole('heading', { name: 'Assigned athletes' })).toBeVisible();
    await evaluationPage.waitForLoadState('networkidle');
    evaluationMonitor.assertClean();
  } finally {
    await evaluationContext.close();
  }

  await page.goto(settingsPath);
  await page.getByLabel('Choose logo').setInputFiles(logoFixture);
  expectCancellableServerAction(ownerMonitor, page, 'organization logo replacement redirect');
  await page.getByRole('button', { name: 'Replace logo' }).click();
  await expect(page.getByRole('status')).toHaveText('Organization logo updated.');
  expectCancellableServerAction(ownerMonitor, page, 'organization logo removal redirect');
  await page.getByRole('button', { name: 'Remove logo' }).click();
  await expect(page.getByRole('status')).toHaveText('Organization logo removed.');
  await expect(
    page.locator('.app-sidebar .app-organization').getByRole('img', {
      name: `${scenario.organizationName} logo fallback`,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(
    page.locator('.mobile-navigation .mobile-organization').getByRole('img', {
      name: `${scenario.organizationName} logo fallback`,
    }),
  ).toHaveText('TF');
  await expectNoHorizontalOverflow(page, '320px organization fallback');
  expect(
    scenario.database.scalar(
      `select (select count(*) from private.organization_brand_assets where organization_id='${scenario.ids.organization}')::text||'|'||(select count(*) from public.audit_logs where organization_id='${scenario.ids.organization}' and action in('organization.logo_updated','organization.logo_removed'))::text`,
    ),
  ).toBe('0|3');
  ownerMonitor.assertClean();
});
