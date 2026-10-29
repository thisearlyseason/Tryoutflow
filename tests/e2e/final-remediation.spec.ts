import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { openAuthenticatedContext, signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import {
  expectCancellableNextRscRequest,
  expectCancellableServerAction,
  monitorBrowserErrors,
} from './helpers/network';

type MailpitAddress = { Address?: unknown };
type MailpitMessage = { ID?: unknown; To?: unknown };

function recipientMatches(message: MailpitMessage, email: string) {
  return (
    Array.isArray(message.To) &&
    message.To.some(
      (recipient: MailpitAddress) =>
        recipient && typeof recipient.Address === 'string' && recipient.Address === email,
    )
  );
}

async function confirmationUrl(request: APIRequestContext, email: string) {
  const local = JSON.parse(
    execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8' }),
  ) as { MAILPIT_URL?: string; INBUCKET_URL?: string };
  const mailpitUrl = new URL(local.MAILPIT_URL ?? local.INBUCKET_URL ?? '');
  if (mailpitUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(mailpitUrl.hostname))
    throw new Error('Email verification tests require local Mailpit.');
  let messageId = '';
  await expect
    .poll(
      async () => {
        const response = await request.get(
          new URL('/api/v1/messages?limit=100', mailpitUrl).toString(),
        );
        if (!response.ok()) return false;
        const payload = (await response.json()) as { messages?: unknown };
        const messages = Array.isArray(payload.messages)
          ? (payload.messages as MailpitMessage[])
          : [];
        const message = messages.find((candidate) => recipientMatches(candidate, email));
        messageId = typeof message?.ID === 'string' ? message.ID : '';
        return messageId.length > 0;
      },
      { message: `verification email for ${email}`, timeout: 15_000 },
    )
    .toBe(true);
  const response = await request.get(
    new URL(`/api/v1/message/${encodeURIComponent(messageId)}`, mailpitUrl).toString(),
  );
  expect(response.ok(), 'Mailpit message details are available').toBe(true);
  const message = (await response.json()) as { HTML?: unknown; Text?: unknown };
  const content = [message.Text, message.HTML]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  const links = content.match(/https?:\/\/[^\s"'<>]+/gu) ?? [];
  const link = links.find((candidate) => {
    const url = new URL(candidate.replaceAll('&amp;', '&'));
    return url.pathname === '/auth/confirm' && url.searchParams.get('type') === 'signup';
  });
  expect(link, 'App confirmation URL is present in the controlled local email').toBeTruthy();
  const url = new URL(link!.replaceAll('&amp;', '&'));
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  // The local mail template uses SiteURL (port 3000). Exercise the same real app handler
  // on this test's owned server; preserve its token and redirect parameters privately.
  url.host = '127.0.0.1:3112';
  return url.toString();
}

test('AC01 anonymous verified owner creates an organization and cycle-backed tryout', async ({
  page,
  request,
  task30Database,
}, testInfo) => {
  const monitor = monitorBrowserErrors(page);
  monitor.allowOptionalRequestFailure({
    errorText: 'NS_BINDING_ABORTED',
    label: 'optional Firefox hashed application icon navigation cancellation',
    maxCount: 1,
    method: 'GET',
    url: /^http:\/\/127\.0\.0\.1:3112\/icon\.svg\?icon\.[a-z0-9]+\.svg$/u,
  });
  const suffix = `${testInfo.project.name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const email = `t30-signup-${suffix}@example.test`;
  const password = `Task30-Signup-${randomUUID()}!Aa`;
  const organizationSlug = `task30-onboarding-${suffix}`;

  await page.context().clearCookies();
  await page.goto('/app');
  await expect(page).toHaveURL(/\/sign-in/u);
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').and(page.locator('input')).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/verify-email\?signup=1$/u);
  await expect(page.getByRole('status')).toContainText('Check your inbox');

  await page.goto(await confirmationUrl(request, email));
  await expect(page).toHaveURL(/\/start$/u);
  await page.getByLabel('Organization name').fill(`AC01 ${testInfo.project.name} Hockey`);
  await expect(page.getByLabel('Workspace address', { exact: true })).not.toBeEmpty();
  await page.getByLabel('Workspace address', { exact: true }).fill(organizationSlug);
  await page.getByLabel('Timezone').fill('America/Edmonton');
  expectCancellableServerAction(monitor, page, 'anonymous owner organization creation redirect');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${organizationSlug}/home$`, 'u'));

  // A redirect updates the URL before its Server Action stream has finished.
  // Wait for the destination UI and follow its real link instead of interrupting
  // that stream with a full-document navigation.
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  const createTryout = page.getByRole('link', { name: 'Create tryout', exact: true });
  await expect(createTryout).toHaveAttribute('href', `/app/${organizationSlug}/tryouts/new`);
  await createTryout.click();
  await expect(page).toHaveURL(new RegExp(`/app/${organizationSlug}/tryouts/new$`, 'u'));
  await page.getByLabel('Tryout name').fill('AC01 Verified Owner Tryout');
  await page.getByLabel('Sport').fill('Hockey');
  await page.getByLabel('New cycle name').fill('2026 Fall Cycle');
  await page.getByLabel('Registration opens').fill('2026-09-01T09:00');
  await page.getByLabel('Registration closes').fill('2026-09-10T21:00');
  expectCancellableServerAction(monitor, page, 'anonymous owner draft creation redirect');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/${organizationSlug}/tryouts/.+/setup/basics$`, 'u'),
  );
  await expect(page.getByRole('heading', { name: 'Guided setup' })).toBeVisible();
  await expect(page.getByLabel('Sport')).toHaveValue('Hockey');
  await expect(page.getByLabel(/Timezone/u)).toHaveValue('America/Edmonton');
  await expect(page.getByLabel('Registration opens')).toHaveValue('2026-09-01T09:00');
  await expect(page.getByLabel('Registration closes')).toHaveValue('2026-09-10T21:00');

  expect(
    task30Database.scalar(
      `select count(*)::text from auth.users account
       join public.organization_members member on member.user_id=account.id
       join public.organizations organization on organization.id=member.organization_id
       join public.tryouts tryout on tryout.organization_id=organization.id
       join public.seasons season on season.id=tryout.season_id
       where account.email='${email}' and account.email_confirmed_at is not null
         and member.role='owner' and member.status='active'
         and organization.slug='${organizationSlug}' and season.name='2026 Fall Cycle'`,
    ),
  ).toBe('1');
  monitor.assertClean();
});

test('owner completes staff registration, returning-athlete, QR, and declared route workflows', async ({
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const registrationPath = `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/registration`;

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/new`);
  await expect(page.getByRole('group', { name: 'Cycle or season' })).toBeVisible();
  await expect(page.getByLabel('New cycle name')).toBeVisible();

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/overview`);
  await page.getByText('View the full tryout checklist', { exact: true }).click();
  const participantsStage = page
    .getByRole('region', { name: 'Tryout journey', exact: true })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Participants', exact: true }) });
  await expect(participantsStage.getByRole('heading', { name: 'Participants' })).toBeVisible();
  await expect(
    participantsStage.getByRole('link', { name: 'Manage participants' }),
  ).toHaveAttribute('href', registrationPath);
  await expect(
    participantsStage.getByRole('link', { name: 'Share registration link' }),
  ).toBeVisible();

  await page.goto(`${registrationPath}?q=Returning`);
  await expect(
    page.getByRole('heading', { name: `${scenario.tryoutName} participants` }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a new participant' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find a returning athlete' })).toBeVisible();
  await expect(page.getByLabel('Returning athlete (optional)')).toContainText('Returning Prospect');
  await page.getByLabel('Returning athlete (optional)').selectOption(scenario.ids.returningAthlete);
  await page.getByLabel('Division').selectOption(scenario.ids.division);
  await page.getByLabel('I consent').check();
  expectCancellableServerAction(monitor, page, 'returning-athlete registration redirect');
  await page.getByRole('button', { name: 'Create registration' }).click();
  await expect(page.getByRole('status')).toContainText('Registration created');
  expect(
    scenario.database.scalar(
      `select count(*) from public.tryout_registrations where organization_id='${scenario.ids.organization}' and tryout_id='${scenario.ids.tryout}' and athlete_id='${scenario.ids.returningAthlete}' and source='staff'`,
    ),
  ).toBe('1');

  await page.goto(registrationPath);
  await page.getByLabel('New athlete first name').fill('Manual');
  await page.getByLabel('New athlete last name').fill('Browser');
  await page.getByLabel('New athlete date of birth').fill('2014-04-05');
  await page.getByLabel('Division').selectOption(scenario.ids.division);
  await page.getByLabel('I consent').check();
  const manualRequestKey = await page.locator('input[name="idempotencyKey"]').inputValue();
  expectCancellableServerAction(monitor, page, 'manual registration redirect');
  await page.getByRole('button', { name: 'Create registration' }).click();
  await expect(page.getByRole('status')).toContainText('Registration created');

  await page.locator('input[name="idempotencyKey"]').evaluate((element, requestKey) => {
    (element as HTMLInputElement).value = requestKey;
  }, manualRequestKey);
  await page.getByLabel('New athlete first name').fill('Conflicting');
  await page.getByLabel('New athlete last name').fill('Content');
  await page.getByLabel('New athlete date of birth').fill('2014-04-06');
  await page.getByLabel('Division').selectOption(scenario.ids.division);
  await page.getByLabel('I consent').check();
  expectCancellableServerAction(monitor, page, 'manual registration idempotency conflict redirect');
  await page.getByRole('button', { name: 'Create registration' }).click();
  const conflictAlert = page.getByRole('alert').filter({ hasText: 'Registration was not created' });
  await expect(conflictAlert).toContainText(
    'this request key is already bound to different content',
  );
  await expect(conflictAlert).toContainText(
    'Review the athlete and form details, then restart the registration',
  );
  expect(
    scenario.database.scalar(
      `select count(*) from public.athletes where organization_id='${scenario.ids.organization}' and given_name='Conflicting' and family_name='Content'`,
    ),
  ).toBe('0');

  const manualRegistration = page.getByRole('listitem').filter({ hasText: 'Manual Browser' });
  await expect(manualRegistration).toBeVisible();
  expectCancellableServerAction(monitor, page, 'QR issuance followed by assisted lookup');
  await manualRegistration.getByRole('button', { name: 'Issue check-in QR' }).click();
  const lookup = manualRegistration.getByRole('link', { name: 'Open QR-assisted lookup' });
  await expect(lookup).toBeVisible();
  await lookup.click();
  await expect(page).toHaveURL(/\/check-in\?qr=[0-9a-f]{64}$/u);
  await expect(page.getByLabel('Search registrations')).toHaveValue(/^[0-9a-f]{64}$/u);
  expectCancellableServerAction(monitor, page, 'QR-assisted registration lookup');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: 'Manual Browser' })).toBeVisible();

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/sessions`);
  await expect(
    page.getByRole('heading', { name: `${scenario.tryoutName} sessions` }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task 30 Exact Scoring' })).toBeVisible();
  await page.goto(`/app/${scenario.organizationSlug}/evaluators`);
  await expect(page.getByRole('heading', { name: 'Evaluator team' })).toBeVisible();
  await page.goto(`/app/${scenario.organizationSlug}/athletes/${scenario.ids.athleteA}`);
  await expect(page.getByRole('heading', { name: 'Exact Aggregate' })).toBeVisible();
  await page.goto(`/app/${scenario.organizationSlug}/evaluate/profile`);
  await expect(page.getByRole('heading', { name: 'Evaluator profile' })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: scenario.organizationName })).toBeVisible();

  await page.goto(`/app/${scenario.organizationSlug}/tryouts?__testLoaderFailure=tryouts`);
  await expect(
    page.getByRole('heading', { name: 'Tryouts temporarily unavailable' }),
  ).toBeVisible();
  await expect(page.getByText('No data was changed.')).toBeVisible();
  expectCancellableNextRscRequest(
    monitor,
    new URL(`/app/${scenario.organizationSlug}/tryouts`, page.url()).toString(),
    'loader retry followed by membership navigation',
  );
  await page.getByRole('link', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Tryouts', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.goto(
    `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/overview?__testLoaderFailure=overview`,
  );
  await expect(page.getByRole('heading', { name: 'Tryout temporarily unavailable' })).toBeVisible();
  await expect(page.getByText('No data was changed.')).toBeVisible();
  expect(
    Number(
      scenario.database.scalar(
        `select count(*) from public.analytics_outbox_events where organization_id='${scenario.ids.organization}' and event_name='workflow.failed' and workflow='tryout_setup'`,
      ),
    ),
  ).toBeGreaterThanOrEqual(1);
  expectCancellableNextRscRequest(
    monitor,
    new URL(
      `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/overview`,
      page.url(),
    ).toString(),
    'overview loader retry',
  );
  await page.getByRole('link', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: scenario.tryoutName })).toBeVisible();

  monitor.allowOptionalConsoleError({
    label: 'injected public registration loader 503',
    maxCount: 1,
    text: /Failed to load resource: the server responded with a status of 503/u,
    url: new RegExp(
      `/api/public/registrations\\?tryoutSlug=${scenario.organizationSlug}-critical-flow`,
      'u',
    ),
  });
  await page.goto(
    `/register/${scenario.organizationSlug}-critical-flow?__testLoaderFailure=public-registration`,
  );
  await expect(
    page.getByRole('heading', { name: 'Registration temporarily unavailable' }),
  ).toBeVisible();
  await expect(page.getByText('No registration was changed.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(
    page.getByRole('heading', { name: `Register for ${scenario.tryoutName}` }),
  ).toBeVisible();

  await page.goto(`/app/${scenario.organizationSlug}/organization/members`);
  const managedMemberLabel = `Member …${scenario.users.member.id.slice(-8)}`;
  let managedMember = page.getByRole('listitem').filter({ hasText: managedMemberLabel });
  await expect(managedMember).toBeVisible();
  await managedMember.getByLabel('Role').selectOption('administrator');
  expectCancellableServerAction(monitor, page, 'audited member role change redirect');
  await managedMember.getByRole('button', { name: 'Save access' }).click();
  await expect(page).toHaveURL(/\/organization\/members\?member=updated$/u);
  expect(
    scenario.database.scalar(
      `select role||':'||status||':'||version from public.organization_members where organization_id='${scenario.ids.organization}' and user_id='${scenario.users.member.id}'`,
    ),
  ).toBe('administrator:active:1');

  managedMember = page.getByRole('listitem').filter({ hasText: managedMemberLabel });
  await managedMember.getByLabel('Access').selectOption('disabled');
  expectCancellableServerAction(monitor, page, 'audited member offboarding redirect');
  await managedMember.getByRole('button', { name: 'Save access' }).click();
  await expect
    .poll(() =>
      scenario.database.scalar(
        `select role||':'||status||':'||version from public.organization_members where organization_id='${scenario.ids.organization}' and user_id='${scenario.users.member.id}'`,
      ),
    )
    .toBe('administrator:disabled:2');
  await expect(managedMember).toContainText('administrator · disabled');

  const ownershipTarget = page
    .getByRole('listitem')
    .filter({ hasText: `Member …${scenario.users.administrator.id.slice(-8)}` });
  expectCancellableServerAction(monitor, page, 'audited ownership transfer redirect');
  await ownershipTarget.getByRole('button', { name: 'Transfer ownership' }).click();
  await expect(page).toHaveURL(/\/organization\/members\?ownership=transferred$/u);
  expect(
    scenario.database.scalar(
      `select string_agg(user_id::text||':'||role,',' order by user_id::text) from public.organization_members where organization_id='${scenario.ids.organization}' and user_id in('${scenario.users.owner.id}','${scenario.users.administrator.id}')`,
    ),
  ).toContain(`${scenario.users.administrator.id}:owner`);
  expect(
    scenario.database.scalar(
      `select count(*) from public.audit_logs where organization_id='${scenario.ids.organization}' and action in('organization.member.role_changed','organization.member.status_changed','organization.ownership.transferred') and actor_user_id='${scenario.users.owner.id}'`,
    ),
  ).toBe('3');
  monitor.assertClean();
});

test('coach invitation verifies a new family, links exactly one athlete, rejects another email, and revokes pending access', async ({
  page,
  browser,
  baseURL,
  request,
  scenario,
}, testInfo) => {
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const inviteForm = page.getByRole('form', { name: 'Invite a family', exact: true });
  const email = `t30-family-${testInfo.project.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Family-Example-${randomUUID()}!Aa9`;
  const athleteName = scenario.database.scalar(
    `select given_name||' '||family_name from public.athletes where id='${scenario.ids.athleteA}'`,
  );
  const athleteBName = scenario.database.scalar(
    `select given_name||' '||family_name from public.athletes where id='${scenario.ids.athleteB}'`,
  );
  await page.goto(`/app/${scenario.organizationSlug}/athletes/${scenario.ids.athleteA}`);
  const familyAccessUrl = new URL(
    `/app/${scenario.organizationSlug}/participants?athlete=${scenario.ids.athleteA}`,
    page.url(),
  );
  expectCancellableNextRscRequest(
    monitor,
    familyAccessUrl.href,
    'athlete profile to family invitation navigation',
  );
  const navigationResponse = page.waitForResponse((r) => {
    const url = new URL(r.url());
    url.searchParams.delete('_rsc');
    return (
      r.request().method() === 'GET' &&
      r.request().headers()['rsc'] === '1' &&
      url.href === familyAccessUrl.href
    );
  });
  await page.getByRole('link', { name: 'Invite family', exact: true }).click();
  expect((await navigationResponse).status()).toBe(200);
  expect((await navigationResponse).headers()['content-type']).toContain('text/x-component');
  await expect(page.getByRole('heading', { name: 'Families & access' })).toBeVisible();
  await expect(inviteForm.getByLabel('Athlete', { exact: true })).toHaveValue(
    scenario.ids.athleteA,
  );
  await page.waitForLoadState('networkidle');
  await inviteForm.getByLabel('Family email').fill(email);
  await inviteForm
    .getByRole('checkbox', { name: 'I’ve confirmed this person should access this athlete.' })
    .check();
  // Next's Flight stream can be canceled after its returned data and UI have
  // committed. Declare only this exact action request, then require HTTP 200,
  // a Flight response and the persisted UI/database outcomes below.
  expectCancellableServerAction(monitor, page, 'coach invitation creation and metadata refresh');
  const createdResponse = page.waitForResponse(
    (r) =>
      r.url() === page.url() &&
      r.request().method() === 'POST' &&
      !!r.request().headers()['next-action'],
  );
  await page.getByRole('button', { name: 'Create family invitation', exact: true }).click();
  expect((await createdResponse).status()).toBe(200);
  expect((await createdResponse).headers()['content-type']).toContain('text/x-component');
  await expect(page.getByRole('region', { name: 'Share family invitation' })).toBeVisible();
  const shareUrl = await page.getByLabel('Private invitation link').inputValue();
  expect(new URL(shareUrl).origin).toBe('https://task30.e2e.example.test');
  // The declared fixture host maps to this isolated server; no external request is made.
  const invitePath = new URL(shareUrl).pathname;
  await page.waitForLoadState('networkidle');
  const wrong = await openAuthenticatedContext({
    browser,
    baseURL: baseURL!,
    user: scenario.users.otherOwner,
    organizationSlug: scenario.otherOrganizationSlug,
  });
  const familyContext = await browser.newContext({ baseURL });
  const family = await familyContext.newPage();
  const familyMonitor = monitorBrowserErrors(family);
  try {
    await wrong.page.goto(invitePath);
    await wrong.page.waitForLoadState('networkidle');
    expectCancellableServerAction(wrong.monitor, wrong.page, 'refused family invitation redirect');
    await wrong.page.getByRole('button', { name: 'Accept family invitation' }).click();
    await expect(
      wrong.page.getByRole('alert').filter({ hasText: 'This invitation could not be accepted' }),
    ).toContainText('This invitation could not be accepted');
    expect(
      scenario.database.scalar(
        `select count(*) from public.participant_links where user_id='${scenario.users.otherOwner.id}' and athlete_id='${scenario.ids.athleteA}'`,
      ),
    ).toBe('0');
    await wrong.page.waitForLoadState('networkidle');
    wrong.monitor.assertClean();

    await family.goto(invitePath);
    await family.waitForLoadState('networkidle');
    await family.getByRole('link', { name: 'Create a family account' }).click();
    await expect(family.locator('input[name="next"]')).toHaveValue(invitePath);
    await family.getByLabel('Email', { exact: true }).fill(email);
    await family.getByLabel('Password', { exact: true }).fill(password);
    await family.getByLabel('Confirm password').and(family.locator('input')).fill(password);
    await family.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(family.getByRole('status')).toContainText('Check your inbox');
    await family.waitForLoadState('networkidle');
    await family.goto(await confirmationUrl(request, email));
    await expect(family).toHaveURL(new RegExp(invitePath + '$', 'u'));
    await expect(family.getByRole('button', { name: 'Accept family invitation' })).toBeVisible();
    await family.waitForLoadState('networkidle');
    expectCancellableServerAction(familyMonitor, family, 'verified family invitation acceptance');
    await family.getByRole('button', { name: 'Accept family invitation' }).click();
    await expect(family).toHaveURL(/\/participant$/u);
    await expect(family.getByRole('heading', { name: athleteName, exact: true })).toBeVisible();
    await expect(family.getByRole('heading', { name: athleteBName, exact: true })).toHaveCount(0);
    await expect(family.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
    expect(
      scenario.database.scalar(
        `select count(*) from public.organization_members where user_id=(select id from auth.users where email='${email}')`,
      ),
    ).toBe('0');
    await family.waitForLoadState('networkidle');
    await family.goto(invitePath);
    await family.waitForLoadState('networkidle');
    expectCancellableServerAction(familyMonitor, family, 'idempotent family acceptance replay');
    await family.getByRole('button', { name: 'Accept family invitation' }).click();
    await expect(family).toHaveURL(/\/participant$/u);
    await expect(family.getByRole('heading', { name: athleteName, exact: true })).toBeVisible();
    expect(
      scenario.database.scalar(
        `select count(*) from public.participant_links where athlete_id='${scenario.ids.athleteA}' and user_id=(select id from auth.users where email='${email}')`,
      ),
    ).toBe('1');

    await page.goto(
      `/app/${scenario.organizationSlug}/participants?athlete=${scenario.ids.athleteB}`,
    );
    await expect(
      page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: athleteName, exact: true }) })
        .filter({ hasText: 'Active family access' }),
    ).toContainText(`Invited email: ${email}`);
    await page.waitForLoadState('networkidle');
    await inviteForm.getByLabel('Family email').fill(email);
    await inviteForm
      .getByRole('checkbox', { name: 'I’ve confirmed this person should access this athlete.' })
      .check();
    expectCancellableServerAction(monitor, page, 'second coach invitation and metadata refresh');
    const secondResponse = page.waitForResponse(
      (r) =>
        r.url() === page.url() &&
        r.request().method() === 'POST' &&
        !!r.request().headers()['next-action'],
    );
    await page.getByRole('button', { name: 'Create family invitation', exact: true }).click();
    expect((await secondResponse).status()).toBe(200);
    expect((await secondResponse).headers()['content-type']).toContain('text/x-component');
    await expect(page.getByRole('region', { name: 'Share family invitation' })).toBeVisible();
    const revokedPath = new URL(await page.getByLabel('Private invitation link').inputValue())
      .pathname;
    const invitationCard = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: athleteBName, exact: true }) })
      .filter({ hasText: email });
    expectCancellableServerAction(
      monitor,
      page,
      'coach invitation revocation and metadata refresh',
    );
    const revokedResponse = page.waitForResponse(
      (r) =>
        r.url() === page.url() &&
        r.request().method() === 'POST' &&
        !!r.request().headers()['next-action'],
    );
    await invitationCard.getByRole('button', { name: 'Revoke invitation' }).click();
    expect((await revokedResponse).status()).toBe(200);
    expect((await revokedResponse).headers()['content-type']).toContain('text/x-component');
    await expect(invitationCard.getByText('Revoked', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Share family invitation' })).toHaveCount(0);
    await family.waitForLoadState('networkidle');
    await family.goto(revokedPath);
    await family.waitForLoadState('networkidle');
    expectCancellableServerAction(familyMonitor, family, 'revoked family invitation refusal');
    await family.getByRole('button', { name: 'Accept family invitation' }).click();
    await expect(
      family.getByRole('alert').filter({ hasText: 'This invitation could not be accepted' }),
    ).toContainText('This invitation could not be accepted');
    expect(
      scenario.database.scalar(
        `select count(*) from public.participant_links where athlete_id='${scenario.ids.athleteB}' and user_id=(select id from auth.users where email='${email}')`,
      ),
    ).toBe('0');
    await family.waitForLoadState('networkidle');
    await page.waitForLoadState('networkidle');
    monitor.assertClean();
    familyMonitor.assertClean();
  } finally {
    await wrong.context.close();
    await familyContext.close();
  }
});

test('organization chooser signs out and switches to a different account without stale access', async ({
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const unsolicitedOnboardingRequests: string[] = [];
  const recordOnboardingRequest = (request: import('@playwright/test').Request) => {
    if (new URL(request.url()).pathname === '/start' && request.headers().rsc === '1') {
      unsolicitedOnboardingRequests.push(request.url());
    }
  };
  page.on('request', recordOnboardingRequest);
  scenario.database.execute(
    `insert into public.organization_members(organization_id,user_id,role,status) values('${scenario.ids.otherOrganization}','${scenario.users.owner.id}','member','active')`,
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app');
  await expect(
    page.getByRole('heading', { name: 'Choose your organization', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /^Open /u })).toHaveCount(2);
  const signOutButton = page.getByRole('button', { name: 'Sign out', exact: true });
  await expect(signOutButton).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.waitForLoadState('networkidle');
  await signOutButton.click();
  await expect(page).toHaveURL(/\/sign-in$/u);
  await expect(
    page.getByRole('heading', { name: 'Sign in to your account', exact: true }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(unsolicitedOnboardingRequests).toEqual([]);
  page.off('request', recordOnboardingRequest);
  await page.goto(`/app/${scenario.organizationSlug}/home`);
  await expect(page).toHaveURL(/\/sign-in\?next=/u);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await signInAs(page, scenario.users.otherOwner, scenario.otherOrganizationSlug, monitor);
  await page.goto('/app');
  await expect(page).toHaveURL(new RegExp(`/app/${scenario.otherOrganizationSlug}/home$`, 'u'));
  await expect(page.locator('main#main-content')).toBeVisible();
  await page.waitForLoadState('networkidle');
  monitor.assertClean();
});

test('athlete search filters the current organization without reloading the workspace', async ({
  page,
  scenario,
}) => {
  const monitor = await signInAs(page, scenario.users.owner, scenario.organizationSlug);
  const directoryPath = `/app/${scenario.organizationSlug}/athletes`;
  await page.goto(directoryPath);
  await expect(page.getByRole('link', { name: 'Exact Aggregate', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tie Alpha', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const documentRequests: string[] = [];
  const recordDocumentRequest = (request: import('@playwright/test').Request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentRequests.push(request.url());
    }
  };
  page.on('request', recordDocumentRequest);
  await page.getByRole('searchbox', { name: 'Search athletes', exact: true }).fill('Exact');
  expectCancellableNextRscRequest(
    monitor,
    new URL(`${directoryPath}?q=Exact`, page.url()).toString(),
    'athlete search page navigation',
  );
  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === directoryPath &&
      url.searchParams.get('q') === 'Exact' &&
      response.request().method() === 'GET' &&
      response.request().headers().rsc === '1'
    );
  });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const response = await searchResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/x-component');
  await expect(page).toHaveURL(new RegExp(`${directoryPath}\\?q=Exact$`, 'u'));
  await expect(page.getByRole('link', { name: 'Exact Aggregate', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tie Alpha', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(documentRequests).toEqual([]);
  page.off('request', recordDocumentRequest);
  monitor.assertClean();
});
