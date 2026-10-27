import { expect, test } from '@playwright/test';
import { expectVisual, signInDemoOwner } from '../helpers/visual';

test('family portal presents a branded athlete, schedule and feedback workspace', async ({
  page,
}) => {
  await signInDemoOwner(page);
  await page.goto('/participant');
  await expect(page.getByRole('heading', { name: 'Avery Synthetic', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your tryout highlights' })).toBeVisible();
  await expectVisual(page, 'family-portal-desktop.png');
  await page.setViewportSize({ width: 393, height: 852 });
  await expectVisual(page, 'family-portal-phone.png');
});

test('coach can clearly review the athlete and family invitation', async ({ page }) => {
  await signInDemoOwner(page);
  await page.goto(
    '/app/badlands-hockey-academy/participants?athlete=29000000-0000-4000-8000-000000000061',
  );
  await expect(page.getByRole('heading', { name: 'Families & access' })).toBeVisible();
  await expect(
    page
      .getByRole('form', { name: 'Invite a family', exact: true })
      .getByLabel('Athlete', { exact: true }),
  ).toHaveValue('29000000-0000-4000-8000-000000000061');
  await expectVisual(page, 'family-invitation-coach.png');
});
