import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const organizationId = '29000000-0000-4000-8000-000000000001';
const tryoutId = '29000000-0000-4000-8000-000000000032';
const email = `task29-${randomUUID()}@example.test`;
const password = `Task29-${randomUUID()}!`;
let databaseUrl = '';
let userId = '';

test.beforeAll(async ({ request }) => {
  const local = JSON.parse(
    execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }),
  ) as { API_URL: string; DB_URL: string; SERVICE_ROLE_KEY: string };
  databaseUrl = local.DB_URL;
  const created = await request.post(`${local.API_URL}/auth/v1/admin/users`, {
    headers: {
      apikey: local.SERVICE_ROLE_KEY,
      authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
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
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app(?:\/|$)/u);
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
  await expect(page.getByText('5 athletes')).toBeVisible();
  await expect(page.getByText('2 completed evaluations')).toBeVisible();
  await expect(page.getByText('1 incomplete evaluations')).toBeVisible();

  const [athletesDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download athletes CSV' }).click(),
  ]);
  const athletesPath = await athletesDownload.path();
  expect(athletesPath).not.toBeNull();
  const athletesCsv = execFileSync('sed', ['-n', '1,20p', athletesPath!], { encoding: 'utf8' });
  expect(athletesCsv).toContain("'=Edge");
  expect(athletesCsv).not.toMatch(
    /guardian|email|phone|birth|emergency|eligibility|private note/iu,
  );

  const [rosterDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download finalized roster CSV' }).click(),
  ]);
  expect(
    execFileSync('sed', ['-n', '1,20p', (await rosterDownload.path())!], { encoding: 'utf8' }),
  ).toContain('Badlands Blue');
  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });

  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('does not leak report existence without an authenticated organization session', async ({
  page,
}) => {
  await page.goto(`/api/organizations/${organizationId}/exports/athletes?tryoutId=${tryoutId}`);
  expect(await page.locator('body').innerText()).toBe('Export not found.');
  await page.goto(`/app/badlands-hockey-academy/tryouts/${tryoutId}/reports`);
  await expect(page).toHaveURL(/\/sign-in\?next=/u);
});
