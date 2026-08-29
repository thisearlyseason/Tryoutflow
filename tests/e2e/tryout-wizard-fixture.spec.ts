import { expect, test } from '@playwright/test';

test('fixture imports the real wizard and supports seven-step navigation, review, confirmation, and no overflow', async ({
  page,
}) => {
  await page.goto('/basics');
  for (const { label, route } of [
    { label: 'Basics', route: 'basics' },
    { label: 'Divisions', route: 'divisions' },
    { label: 'Sessions', route: 'sessions' },
    { label: 'Registration', route: 'registration' },
    { label: 'Rubrics', route: 'rubrics' },
    { label: 'Review', route: 'review' },
    { label: 'Publish', route: 'publish' },
  ]) {
    await page.getByRole('link', { name: new RegExp(label) }).click();
    await expect(page).toHaveURL(new RegExp(`/${route}$`));
    await expect(page.getByRole('link', { name: new RegExp(label) })).toHaveAttribute(
      'aria-current',
      'step',
    );
  }
  await expect(page.getByRole('heading', { name: 'Publish tryout' })).toBeVisible();
  await page.getByLabel('Type “Fall ID Camp” to publish').fill('Fall ID Camp');
  await expect(page.getByRole('button', { name: 'Publish tryout' })).toBeEnabled();
  await page.goto('/review');
  await expect(page.getByText('rubric invalid')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
