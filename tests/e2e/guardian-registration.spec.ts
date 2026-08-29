import { expect, test } from '@playwright/test';

test('guardian can complete the accessible public registration form on mobile', async ({
  page,
}) => {
  await page.route('**/api/public/registrations?tryoutSlug=fall-id-camp', async (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tryout: {
          name: 'Fall ID Camp',
          formSchema: {
            fields: [
              { key: 'consent', label: 'I consent', kind: 'consent', required: true, sortOrder: 0 },
            ],
          },
          divisions: [{ id: '11111111-1111-4111-8111-111111111111', name: 'U13' }],
        },
      }),
    }),
  );
  await page.route('**/api/public/registrations', async (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
  );

  await page.goto('/register/fall-id-camp');
  await page.getByLabel('Athlete first name').fill('Ava');
  await page.getByLabel('Athlete last name').fill('Smith');
  await page.getByLabel('Date of birth').fill('2013-05-01');
  await page.getByLabel('Guardian name').fill('Taylor Smith');
  await page.getByLabel('Guardian email').fill('guardian@example.com');
  await page.getByLabel('I consent').check();
  await page.getByRole('button', { name: 'Submit registration' }).click();
  await expect(page).toHaveURL(/confirmation/);
  await expect(page.getByRole('heading', { name: 'Registration confirmation' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
