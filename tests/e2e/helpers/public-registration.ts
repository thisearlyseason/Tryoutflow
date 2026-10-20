import { expect, type Page } from '@playwright/test';

export async function continuePublicRegistration(page: Page) {
  await expect(page.getByRole('heading', { name: 'Registration details' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'Additional details' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
}

export async function reviewPublicRegistration(page: Page) {
  await expect(page.getByRole('heading', { name: 'Additional details' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to review' }).click();
  const heading = page.getByRole('heading', { name: 'Review registration' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
}
