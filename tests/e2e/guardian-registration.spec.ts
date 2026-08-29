import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const realSupabase = process.env.E2E_REAL_SUPABASE === '1';

test.beforeAll(() => {
  if (!realSupabase) return;
  execFileSync(
    'psql',
    [
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      resolve('tests/fixtures/registration/seed.sql'),
    ],
    { stdio: 'pipe' },
  );
});

test('guardian can complete the accessible public registration form on mobile', async ({
  page,
}) => {
  if (!realSupabase) {
    await page.route('**/api/public/registrations?tryoutSlug=fall-id-camp', async (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          tryout: {
            name: 'Fall ID Camp',
            formSchema: {
              fields: [
                {
                  key: 'consent',
                  label: 'I consent',
                  kind: 'consent',
                  required: true,
                  sortOrder: 0,
                },
              ],
            },
            divisions: [{ id: '11111111-1111-4111-8111-111111111111', name: 'U13' }],
            positions: [],
          },
        }),
      }),
    );
    await page.route('**/api/public/registrations', async (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );
  }

  await page.goto(realSupabase ? '/register/http-registration-camp' : '/register/fall-id-camp');
  await page.getByLabel('Athlete first name').fill('Ava');
  await page.getByLabel('Athlete last name').fill('Smith');
  await page.getByLabel('Date of birth').fill('2013-05-01');
  await page.getByLabel('Guardian name').fill('Taylor Smith');
  await page.getByLabel('Guardian email').fill('guardian@example.com');
  if (realSupabase) {
    await page.getByLabel('Guardian phone').fill('+1 (403) 555-0100');
    await page.getByLabel('Player email').fill('player@example.com');
    await page.getByLabel('Player phone').fill('+1 (403) 555-0101');
    await page.getByLabel('Medical date').fill('2024-02-29');
    await page.locator('select[name="positionId"]').selectOption({ label: 'Goalie' });
    await page.locator('select[name="position"]').selectOption('Goalie');
    await page.getByLabel('Consent').check();
  } else {
    await page.getByLabel('I consent').check();
  }
  const submissionResponse = realSupabase
    ? page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/public/registrations') &&
          response.request().method() === 'POST',
      )
    : null;
  await page.getByRole('button', { name: 'Submit registration' }).click();
  if (submissionResponse) {
    const response = await submissionResponse;
    const failureBody = response.status() === 200 ? '' : await response.text();
    expect(response.status(), failureBody).toBe(200);
  }
  await expect(page).toHaveURL(/confirmation/);
  await expect(page.getByRole('heading', { name: 'Registration confirmation' })).toBeVisible();
  if (realSupabase) {
    await page.getByRole('button', { name: 'Confirm registration' }).click();
    await expect(page.getByText('Your registration is confirmed.')).toBeVisible();
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
