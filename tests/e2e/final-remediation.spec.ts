import { randomUUID } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

import { signInAs } from './helpers/auth';
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
  let messageId = '';
  await expect
    .poll(
      async () => {
        const response = await request.get('http://127.0.0.1:54324/api/v1/messages?limit=100');
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
    `http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(messageId)}`,
  );
  expect(response.ok(), 'Mailpit message details are available').toBe(true);
  const message = (await response.json()) as { HTML?: unknown; Text?: unknown };
  const content = [message.Text, message.HTML]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  const links = content.match(/https?:\/\/[^\s"'<>]+/gu) ?? [];
  const link = links.find((candidate) => candidate.includes('/auth/v1/verify?'));
  expect(link, 'Supabase verification URL is present in the controlled local email').toBeTruthy();
  return link!.replaceAll('&amp;', '&');
}

test('AC01 anonymous verified owner creates an organization and cycle-backed tryout', async ({
  page,
  request,
  task30Database,
}, testInfo) => {
  const monitor = monitorBrowserErrors(page);
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
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/verify-email\?signup=1$/u);
  await expect(page.getByRole('status')).toContainText('Check your inbox');

  await page.goto(await confirmationUrl(request, email));
  await expect(page).toHaveURL(/\/start$/u);
  await page.getByLabel('Organization name').fill(`AC01 ${testInfo.project.name} Hockey`);
  await page.getByLabel('Organization URL').fill(organizationSlug);
  expectCancellableServerAction(monitor, page, 'anonymous owner organization creation redirect');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${organizationSlug}/home$`, 'u'));

  await page.goto(`/app/${organizationSlug}/tryouts/new`);
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

  await page.goto(`${registrationPath}?q=Returning`);
  await expect(
    page.getByRole('heading', { name: `${scenario.tryoutName} registrations` }),
  ).toBeVisible();
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
  expectCancellableServerAction(monitor, page, 'manual registration redirect');
  await page.getByRole('button', { name: 'Create registration' }).click();
  await expect(page.getByRole('status')).toContainText('Registration created');
  const manualRegistration = page.getByRole('listitem').filter({ hasText: 'Manual Browser' });
  await expect(manualRegistration).toBeVisible();
  expectCancellableServerAction(monitor, page, 'QR issuance followed by assisted lookup');
  await manualRegistration.getByRole('button', { name: 'Issue check-in QR' }).click();
  const lookup = manualRegistration.getByRole('link', { name: 'Open QR-assisted lookup' });
  await expect(lookup).toBeVisible();
  await lookup.click();
  await expect(page).toHaveURL(/\/check-in\?qr=[0-9a-f]{64}$/u);
  await expect(page.getByLabel('Search registrations')).toHaveValue(/^[0-9a-f]{64}$/u);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: 'Manual Browser' })).toBeVisible();

  await page.goto(`/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/sessions`);
  await expect(
    page.getByRole('heading', { name: `${scenario.tryoutName} sessions` }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Task 30 Exact Scoring' })).toBeVisible();
  await page.goto(`/app/${scenario.organizationSlug}/evaluators`);
  await expect(page.getByRole('heading', { name: 'Evaluator directory' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Tryouts' })).toBeVisible();
  await page.waitForLoadState('networkidle');

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
