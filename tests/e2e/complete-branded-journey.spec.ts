import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { signInAs } from './helpers/auth';
import { task30AuthBrowserAddress } from './helpers/environment';
import { expect, test } from './helpers/fixtures';
import {
  expectCancellableImageRequest,
  expectCancellableNextRscRequest,
  expectCancellableServerAction,
  monitorBrowserErrors,
} from './helpers/network';

const logoFixture = resolve('tests/fixtures/branding/organization-logo.png');
const replacementLogoFixture = resolve('tests/fixtures/branding/organization-logo-replacement.png');

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
    description: `role=owner/evaluator; organization=${scenario.organizationSlug}; authored tryout, participant, check-in, and evaluation=complete branded journey`,
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  const ownerMonitor = await signInAs(
    page,
    scenario.users.owner,
    scenario.organizationSlug,
    undefined,
    (token) =>
      scenario.database.trackAbuseAttempt({
        scope: 'auth_sign_in',
        action: 'sign_in',
        subject: scenario.users.owner.email,
        address: task30AuthBrowserAddress,
        token,
      }),
  );
  const settingsPath = `/app/${scenario.organizationSlug}/organization/settings`;
  const [registrationOpens, registrationCloses, sessionStarts, sessionEnds] = scenario.database
    .scalar(
      `with anchor as(select date_trunc('minute',clock_timestamp()) as now_at),bounds as(select now_at-interval '30 days' as registration_opens,now_at+interval '180 days' as registration_closes,now_at+interval '181 days' as session_starts,now_at+interval '181 days 2 hours' as session_ends from anchor) select to_char(registration_opens at time zone 'America/Edmonton','YYYY-MM-DD"T"HH24:MI')||'|'||to_char(registration_closes at time zone 'America/Edmonton','YYYY-MM-DD"T"HH24:MI')||'|'||to_char(session_starts at time zone 'America/Edmonton','YYYY-MM-DD"T"HH24:MI')||'|'||to_char(session_ends at time zone 'America/Edmonton','YYYY-MM-DD"T"HH24:MI') from bounds`,
    )
    .split('|');
  expect([registrationOpens, registrationCloses, sessionStarts, sessionEnds]).not.toContain(
    undefined,
  );

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
  const initialLogoResponse = await page.request.get(
    `/api/organizations/${scenario.organizationSlug}/logo`,
  );
  expect(initialLogoResponse.status()).toBe(200);
  const initialLogoEtag = initialLogoResponse.headers().etag;
  expect(initialLogoEtag).toMatch(/^"[0-9a-f]{64}"$/u);
  const initialLogoProof = scenario.database.scalar(
    `select sha256||'|'||updated_at::text from private.organization_brand_assets where organization_id='${scenario.ids.organization}'`,
  );
  const initialLogoSrc = await page
    .locator('.app-sidebar .app-organization')
    .getByRole('img', { name: `${scenario.organizationName} logo` })
    .getAttribute('src');
  expect(initialLogoSrc).toContain('/api/organizations/');

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
  await page.getByLabel('Registration opens').fill(registrationOpens!);
  await page.getByLabel('Registration closes').fill(registrationCloses!);
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
  await expect(page.getByLabel('Registration opens')).toHaveValue(registrationOpens!);
  await expect(page.getByLabel('Registration closes')).toHaveValue(registrationCloses!);
  await page.reload();
  await expect(page.getByLabel('Tryout name')).toHaveValue(tryoutName);
  await expect(page.getByLabel('Registration closes')).toHaveValue(registrationCloses!);
  expectCancellableServerAction(ownerMonitor, page, 'guided basics persistence redirect');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  expect(
    scenario.database.scalar(
      `select (registration_starts_at<clock_timestamp())::text||'|'||(registration_ends_at>clock_timestamp()+interval '150 days')::text||'|'||to_char(registration_starts_at at time zone timezone,'YYYY-MM-DD"T"HH24:MI')||'|'||to_char(registration_ends_at at time zone timezone,'YYYY-MM-DD"T"HH24:MI') from public.tryouts where organization_id='${scenario.ids.organization}' and id='${authoredTryoutId}'`,
    ),
  ).toBe(`true|true|${registrationOpens}|${registrationCloses}`);

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
  await page.getByLabel('Starts').fill(sessionStarts!);
  await page.getByLabel('Ends').fill(sessionEnds!);
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
  const authoredSessionId = scenario.database.scalar(
    `select id from public.tryout_sessions where organization_id='${scenario.ids.organization}' and tryout_id='${authoredTryoutId}' and name='Skills Session 1'`,
  );
  expect(authoredSessionId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(
    scenario.database.scalar(
      `select to_char(starts_at at time zone 'America/Edmonton','YYYY-MM-DD"T"HH24:MI')||'|'||to_char(ends_at at time zone 'America/Edmonton','YYYY-MM-DD"T"HH24:MI') from public.tryout_sessions where organization_id='${scenario.ids.organization}' and id='${authoredSessionId}'`,
    ),
  ).toBe(`${sessionStarts}|${sessionEnds}`);

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/staff`);
  await expect(page.getByRole('heading', { name: `${tryoutName} evaluators` })).toBeVisible();
  await page.locator('select[name="evaluatorUserId"]').selectOption(scenario.users.evaluatorOne.id);
  await page.locator('select[name="scope"]').selectOption(`tryout:${authoredTryoutId}`);
  expectCancellableServerAction(ownerMonitor, page, 'authored tryout evaluator assignment');
  await page.getByRole('button', { name: 'Assign evaluator' }).click();
  await expect(page.getByText('Evaluator assigned.', { exact: true })).toBeVisible();
  expect(
    scenario.database.scalar(
      `select count(*) from public.tryout_staff_assignments where organization_id='${scenario.ids.organization}' and tryout_id='${authoredTryoutId}' and user_id='${scenario.users.evaluatorOne.id}' and role='evaluator' and scope_kind='tryout' and revoked_at is null`,
    ),
  ).toBe('1');

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/setup/review`);
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
    scenario.database.trackAbuseAttempt({
      scope: 'public_registration',
      action: 'public_registration',
      subject: publicSlug,
      address: scenario.publicClientAddress,
      token: await publicPage.locator('input[name="cf-turnstile-response"]').inputValue(),
    });
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
  const authoredRegistrationId = scenario.database.scalar(
    `select registration.id from public.tryout_registrations registration join public.athletes athlete on athlete.id=registration.athlete_id and athlete.organization_id=registration.organization_id where registration.organization_id='${scenario.ids.organization}' and registration.tryout_id='${authoredTryoutId}' and athlete.family_name='${familyName}'`,
  );
  expect(authoredRegistrationId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(
    scenario.database.scalar(
      `select count(*) from public.session_enrollments where organization_id='${scenario.ids.organization}' and tryout_id='${authoredTryoutId}' and registration_id='${authoredRegistrationId}' and session_id='${authoredSessionId}'`,
    ),
  ).toBe('1');

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/overview`);
  await expect(page.getByRole('heading', { name: 'Tryout journey' })).toBeVisible();
  const runStage = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Run tryout' }),
  });
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/check-in`,
    'journey check-in navigation RSC request',
  );
  await runStage.locator('a[href$="/check-in"]').click();
  await expect(page.getByRole('heading', { name: `${tryoutName} check-in` })).toBeVisible();
  await page.getByLabel('Search registrations').fill(familyName);
  expectCancellableServerAction(ownerMonitor, page, 'authored participant check-in search');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: `Jordan ${familyName}` })).toBeVisible();
  expectCancellableServerAction(ownerMonitor, page, 'authored participant check-in action');
  await page.getByRole('button', { name: `Check in Jordan ${familyName}` }).click();
  await expect(page.getByRole('status')).toContainText(`Jordan ${familyName} checked in`);
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/live`,
    'check-in to live navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Open live dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Live dashboard' })).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/rankings`,
    'live to rankings navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Review rankings' }).click();
  await expect(page.getByRole('heading', { name: 'Rankings' })).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/rosters`,
    'rankings to rosters navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Build rosters' }).click();
  await expect(page.getByRole('heading', { name: `${tryoutName} rosters` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create a draft roster' })).toBeVisible();
  await page.getByLabel('Team 1 name').fill('North');
  await page.getByLabel('Team 2 name').fill('South');
  expectCancellableServerAction(ownerMonitor, page, 'authored roster draft creation');
  await page.getByRole('button', { name: 'Create draft roster' }).click();
  await expect(page.getByRole('heading', { name: 'Draft roster · version 1' })).toBeVisible();

  const authoredRosterAthlete = page.locator(
    `[data-testid="roster-athlete-${authoredRegistrationId}"]`,
  );
  await expect(
    authoredRosterAthlete.getByRole('heading', { name: `Jordan ${familyName}` }),
  ).toBeVisible();
  await authoredRosterAthlete.getByLabel(`Select Jordan ${familyName}`).check();
  await page.getByLabel('Bulk decision').selectOption('selected');
  await page.getByRole('button', { name: 'Review decision for 1 athlete' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Confirm bulk decision' }),
  ).toBeVisible();
  expectCancellableServerAction(ownerMonitor, page, 'authored participant selected decision');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm decisions' }).click();
  await expect(
    page.getByText('1 decision saved. No messages were sent.', { exact: true }),
  ).toBeVisible();

  await authoredRosterAthlete.getByRole('button', { name: `Move Jordan ${familyName}` }).click();
  const moveDialog = page.getByRole('dialog');
  await moveDialog.getByLabel('Destination team').selectOption({ label: 'North' });
  expectCancellableServerAction(ownerMonitor, page, 'authored participant roster placement');
  await moveDialog.getByRole('button', { name: 'Confirm move' }).click();
  await expect(page.getByText(/placement saved to roster version/u)).toBeVisible();

  await page.getByRole('button', { name: 'Finalize roster' }).click();
  const finalizeDialog = page.getByRole('dialog');
  await finalizeDialog.getByLabel('I understand this roster becomes immutable').check();
  expectCancellableServerAction(ownerMonitor, page, 'authored roster finalization');
  await finalizeDialog.getByRole('button', { name: 'Confirm finalization' }).click();
  await expect(page.getByRole('heading', { name: 'Finalized roster · immutable' })).toBeVisible();
  await expect(
    page.getByText('Roster finalized. No messages were sent by finalization.'),
  ).toBeVisible();
  expect(
    scenario.database.scalar(
      `select roster.state||'|'||decision.status||'|'||team.name from public.roster_versions roster join public.roster_decisions decision on decision.organization_id=roster.organization_id and decision.roster_version_id=roster.id join public.roster_assignments assignment on assignment.organization_id=roster.organization_id and assignment.roster_version_id=roster.id and assignment.registration_id=decision.registration_id join public.tryout_teams team on team.organization_id=roster.organization_id and team.tryout_id=roster.tryout_id and team.division_id=roster.division_id and team.id=assignment.team_id where roster.organization_id='${scenario.ids.organization}' and roster.tryout_id='${authoredTryoutId}' and decision.registration_id='${authoredRegistrationId}'`,
    ),
  ).toBe('finalized|selected|North');
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/messages`,
    'rosters to messages navigation RSC request',
  );
  await page.getByRole('link', { name: 'Next: Review communication' }).click();
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  expectCancellableNextRscRequest(
    ownerMonitor,
    `${baseURL}/app/${scenario.organizationSlug}/tryouts/${authoredTryoutId}/reports`,
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
      (token) =>
        scenario.database.trackAbuseAttempt({
          scope: 'auth_sign_in',
          action: 'sign_in',
          subject: scenario.users.evaluatorOne.email,
          address: task30AuthBrowserAddress,
          token,
        }),
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
    const authoredSessionCard = evaluationPage
      .getByRole('listitem')
      .filter({ hasText: tryoutName })
      .filter({ hasText: 'Skills Session 1' });
    await expect(authoredSessionCard).toBeVisible();
    expectCancellableNextRscRequest(
      evaluationMonitor,
      `${baseURL}/app/${scenario.organizationSlug}/evaluate/session/${authoredSessionId}`,
      'authored scoring session navigation RSC request',
    );
    await authoredSessionCard.getByRole('link', { name: 'Open scoring session' }).click();
    await expect(evaluationPage.getByRole('heading', { name: 'Skills Session 1' })).toBeVisible();
    await evaluationPage.waitForLoadState('networkidle');
    expectCancellableNextRscRequest(
      evaluationMonitor,
      `${baseURL}/app/${scenario.organizationSlug}/evaluate/session/${authoredSessionId}/athletes`,
      'authored assigned-athlete navigation RSC request',
    );
    await evaluationPage.getByRole('link', { name: 'Assigned athletes' }).click();
    await expect(evaluationPage.getByRole('heading', { name: 'Assigned athletes' })).toBeVisible();
    const authoredParticipant = evaluationPage.getByRole('listitem').filter({
      hasText: `Jordan ${familyName}`,
    });
    await expect(authoredParticipant).toBeVisible();
    expectCancellableNextRscRequest(
      evaluationMonitor,
      `${baseURL}/app/${scenario.organizationSlug}/evaluate/session/${authoredSessionId}/athletes/${authoredRegistrationId}`,
      'authored participant evaluation navigation RSC request',
    );
    await authoredParticipant.getByRole('link', { name: 'Start evaluation' }).click();
    await expect(
      evaluationPage.getByRole('heading', { name: `Jordan ${familyName}` }),
    ).toBeVisible();
    const authoredScaleMaximum = scenario.database.scalar(
      `select category.scale_max from public.rubric_categories category join public.rubric_versions version on version.id=category.rubric_version_id and version.organization_id=category.organization_id and version.tryout_id=category.tryout_id where category.organization_id='${scenario.ids.organization}' and category.tryout_id='${authoredTryoutId}' and category.name='Skating'`,
    );
    await evaluationPage
      .getByRole('radio', {
        name: `Skating score ${authoredScaleMaximum} of ${authoredScaleMaximum}`,
      })
      .click();
    await evaluationPage.getByRole('button', { name: 'Save now' }).click();
    await expect(evaluationPage.getByText('Saved on server', { exact: true })).toBeVisible();
    expectCancellableServerAction(
      evaluationMonitor,
      evaluationPage,
      'authored participant evaluation completion',
    );
    await evaluationPage.getByRole('button', { name: 'Complete evaluation' }).click();
    await expect(
      evaluationPage.getByRole('button', { name: 'Evaluation completed' }),
    ).toBeDisabled();
    await evaluationPage.waitForLoadState('networkidle');
    expect(
      scenario.database.scalar(
        `select count(*) from public.evaluations where organization_id='${scenario.ids.organization}' and tryout_id='${authoredTryoutId}' and tryout_registration_id='${authoredRegistrationId}' and tryout_session_id='${authoredSessionId}' and evaluator_user_id='${scenario.users.evaluatorOne.id}' and state='completed'`,
      ),
    ).toBe('1');
    evaluationMonitor.assertClean();
  } finally {
    await evaluationContext.close();
  }

  await page.goto(settingsPath);
  await page.getByLabel('Choose logo').setInputFiles(replacementLogoFixture);
  expectCancellableServerAction(ownerMonitor, page, 'organization logo replacement redirect');
  await page.getByRole('button', { name: 'Replace logo' }).click();
  await expect(page.getByRole('status')).toHaveText('Organization logo updated.');
  const replacementLogoProof = scenario.database.scalar(
    `select sha256||'|'||updated_at::text from private.organization_brand_assets where organization_id='${scenario.ids.organization}'`,
  );
  expect(replacementLogoProof).not.toBe(initialLogoProof);
  const replacementLogoResponse = await page.request.get(
    `/api/organizations/${scenario.organizationSlug}/logo`,
    { headers: { 'if-none-match': initialLogoEtag! } },
  );
  expect(replacementLogoResponse.status()).toBe(200);
  expect(replacementLogoResponse.headers().etag).toMatch(/^"[0-9a-f]{64}"$/u);
  expect(replacementLogoResponse.headers().etag).not.toBe(initialLogoEtag);
  const replacementLogo = page
    .locator('.app-sidebar .app-organization')
    .getByRole('img', { name: `${scenario.organizationName} logo` });
  await expect(replacementLogo).toBeVisible();
  await expect.poll(() => replacementLogo.getAttribute('src')).not.toBe(initialLogoSrc);
  await expect
    .poll(() =>
      replacementLogo.evaluate(
        (element) =>
          element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
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

  const fallbackContext = await browser.newContext({
    baseURL: String(baseURL),
    locale: 'en-CA',
    timezoneId: 'America/Edmonton',
    viewport: { width: 320, height: 844 },
  });
  const fallbackPage = await fallbackContext.newPage();
  const fallbackMonitor = monitorBrowserErrors(fallbackPage);
  try {
    await fallbackPage.goto(publicPath);
    await expect(
      fallbackPage.getByRole('img', {
        name: `${scenario.organizationName} logo fallback`,
      }),
    ).toHaveText('TF');
    await expect(
      fallbackPage.getByRole('heading', { name: `Register for ${tryoutName}` }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(fallbackPage, '320px public registration fallback');
    fallbackMonitor.assertClean();
  } finally {
    fallbackMonitor.stop();
    await fallbackContext.close();
  }
  expect(
    scenario.database.scalar(
      `select (select count(*) from private.organization_brand_assets where organization_id='${scenario.ids.organization}')::text||'|'||(select count(*) from public.audit_logs where organization_id='${scenario.ids.organization}' and action in('organization.logo_updated','organization.logo_removed'))::text`,
    ),
  ).toBe('0|3');
  ownerMonitor.assertClean();
});
