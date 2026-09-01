import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const organizationId = '29000000-0000-4000-8000-000000000001';
const tryoutId = '29000000-0000-4000-8000-000000000201';
const rosterVersionId = '29000000-0000-4000-8000-000000000283';
const email = `task29-${randomUUID()}@example.test`;
const password = `Task29-${randomUUID()}!`;
let databaseUrl = '';
let userId = '';
let apiUrl = '';
let serviceRoleKey = '';

test.beforeAll(async ({ request }) => {
  const local = JSON.parse(
    execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }),
  ) as { API_URL: string; DB_URL: string; SECRET_KEY?: string; SERVICE_ROLE_KEY: string };
  databaseUrl = local.DB_URL;
  apiUrl = local.API_URL;
  serviceRoleKey = local.SECRET_KEY ?? local.SERVICE_ROLE_KEY;
  const created = await request.post(`${local.API_URL}/auth/v1/admin/users`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
    data: { email, password, email_confirm: true },
  });
  expect(created.ok(), await created.text()).toBe(true);
  userId = String(((await created.json()) as { id: unknown }).id);
  execFileSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      databaseUrl,
      '-c',
      `insert into public.organization_members(organization_id,user_id,role,status)
       values('${organizationId}','${userId}','administrator','active')`,
    ],
    { stdio: 'pipe' },
  );
});

test.afterAll(() => {
  if (!databaseUrl || !userId) return;
  execFileSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      databaseUrl,
      '-c',
      `delete from public.organization_members where organization_id='${organizationId}' and user_id='${userId}';
       delete from auth.users where id='${userId}';`,
    ],
    { stdio: 'pipe' },
  );
});

async function signIn(page: import('@playwright/test').Page) {
  await signInAs(page, email, password);
}

async function signInAs(
  page: import('@playwright/test').Page,
  signInEmail: string,
  signInPassword: string,
) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(signInEmail);
  await page.getByLabel('Password').fill(signInPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/u);
}

async function createScopedUser(
  request: import('@playwright/test').APIRequestContext,
  role: 'reviewer' | 'evaluator' | null,
  status: 'active' | 'disabled' = 'active',
) {
  const scopedEmail = `task29-${role ?? status}-${randomUUID()}@example.test`;
  const scopedPassword = `Task29-${randomUUID()}!`;
  const created = await request.post(`${apiUrl}/auth/v1/admin/users`, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
    data: { email: scopedEmail, password: scopedPassword, email_confirm: true },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const scopedUserId = String(((await created.json()) as { id: unknown }).id);
  const assignment = role
    ? `insert into public.tryout_staff_assignments(
         id,organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id)
       values('${randomUUID()}','${organizationId}','${scopedUserId}','${role}','tryout','${tryoutId}',
         '29000000-0000-4000-8000-000000000011');`
    : '';
  execFileSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      databaseUrl,
      '-c',
      `insert into public.organization_members(organization_id,user_id,role,status)
       values('${organizationId}','${scopedUserId}','member','${status}'); ${assignment}`,
    ],
    { stdio: 'pipe' },
  );
  return { email: scopedEmail, password: scopedPassword, userId: scopedUserId };
}

function deleteScopedUsers(ids: string[]) {
  if (ids.length === 0) return;
  const quoted = ids.map((id) => `'${id}'`).join(',');
  execFileSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      databaseUrl,
      '-c',
      `delete from public.tryout_staff_assignments where user_id in (${quoted});
       delete from public.organization_members where user_id in (${quoted});
       delete from auth.users where id in (${quoted});`,
    ],
    { stdio: 'pipe' },
  );
}

test('loads durable onboarding and downloads sanitized authorized report snapshots', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/app/badlands-hockey-academy/home');
  await expect(
    page.getByRole('heading', { name: 'Your tryout operations checklist' }),
  ).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Onboarding progress' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );

  await page.goto(`/app/badlands-hockey-academy/tryouts/${tryoutId}/reports`);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByText(/another finalized roster.*unavailable/i)).toBeVisible();
  await expect(page.getByText('2 athletes')).toBeVisible();
  await expect(page.getByText('1 completed evaluations')).toBeVisible();
  await expect(page.getByText('1 incomplete evaluations')).toBeVisible();

  const [athletesDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download athletes CSV' }).click(),
  ]);
  const athletesPath = await athletesDownload.path();
  expect(athletesPath).not.toBeNull();
  const athletesCsv = execFileSync('sed', ['-n', '1,20p', athletesPath!], { encoding: 'utf8' });
  expect(athletesCsv).toContain('Avery,Converged');
  expect(athletesCsv).not.toMatch(
    /guardian|email|phone|birth|emergency|eligibility|private note/iu,
  );

  const [evaluationsDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download evaluations CSV' }).click(),
  ]);
  const evaluationsCsv = execFileSync('sed', ['-n', '1,20p', (await evaluationsDownload.path())!], {
    encoding: 'utf8',
  });
  expect(evaluationsCsv).toContain('92.0000');
  expect(evaluationsCsv).toContain('Completed,Locked,Reopened,Draft,Invalid,Scored evaluators');
  expect(evaluationsCsv).not.toMatch(/evaluator-one|private note|guardian|email|phone/iu);

  const [rosterDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download finalized roster CSV' }).click(),
  ]);
  expect(
    execFileSync('sed', ['-n', '1,20p', (await rosterDownload.path())!], { encoding: 'utf8' }),
  ).toContain('Converged Blue');
  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });

  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('exposes only the exact final-roster report to reviewers and denies other scoped roles', async ({
  page,
  request,
}) => {
  const created: string[] = [];
  try {
    const reviewer = await createScopedUser(request, 'reviewer');
    const evaluator = await createScopedUser(request, 'evaluator');
    const member = await createScopedUser(request, null);
    const offboarded = await createScopedUser(request, null, 'disabled');
    created.push(reviewer.userId, evaluator.userId, member.userId, offboarded.userId);

    await signInAs(page, reviewer.email, reviewer.password);
    await page.goto('/app/badlands-hockey-academy/home');
    await expect(page.getByRole('link', { name: `Reports for tryout ${tryoutId}` })).toBeVisible();
    await page.getByRole('link', { name: `Reports for tryout ${tryoutId}` }).click();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByText(/another finalized roster.*unavailable/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download finalized roster CSV' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download athletes CSV' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Download evaluations CSV' })).toHaveCount(0);
    const [reviewerDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download finalized roster CSV' }).click(),
    ]);
    expect(
      execFileSync('sed', ['-n', '1,10p', (await reviewerDownload.path())!], {
        encoding: 'utf8',
      }),
    ).toContain('Converged Blue');
    for (const exportType of ['athletes', 'evaluations']) {
      await page.goto(
        `/api/organizations/${organizationId}/exports/${exportType}?tryoutId=${tryoutId}`,
      );
      await expect(page.locator('body')).toHaveText('Export not found.');
    }

    for (const denied of [evaluator, member, offboarded]) {
      await page.context().clearCookies();
      await page.goto('/sign-in');
      await page.evaluate(() => window.localStorage.clear());
      await signInAs(page, denied.email, denied.password);
      await page.goto(
        `/api/organizations/${organizationId}/exports/evaluations?tryoutId=${tryoutId}`,
      );
      await expect(page.locator('body')).toHaveText('Export not found.');
    }
    await page.goto(
      `/api/organizations/39000000-0000-4000-8000-000000000001/exports/roster?tryoutId=${tryoutId}&rosterVersionId=${rosterVersionId}`,
    );
    await expect(page.locator('body')).toHaveText('Export not found.');
  } finally {
    deleteScopedUsers(created);
  }
});

test('does not leak report existence without an authenticated organization session', async ({
  page,
}) => {
  await page.goto(`/api/organizations/${organizationId}/exports/athletes?tryoutId=${tryoutId}`);
  expect(await page.locator('body').innerText()).toBe('Export not found.');
  await page.goto(`/app/badlands-hockey-academy/tryouts/${tryoutId}/reports`);
  await expect(page).toHaveURL(/\/sign-in\?next=/u);
});
