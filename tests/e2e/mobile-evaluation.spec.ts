import { expect, test } from '@playwright/test';

test('scores assigned athletes one-handed without losing an in-page draft', async ({ page }) => {
  await page.goto('/cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await expect(page.getByRole('heading', { name: 'Athlete A1B2C3' })).toBeVisible();
  await expect(page.getByText('#42')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Ava Smith');

  const skating = page.getByRole('radio', { name: 'Skating score 3 of 5' });
  await skating.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Skating score 4 of 5' })).toBeChecked();
  await page.getByLabel('Private evaluator note').fill('Strong edge control');
  await expect(page.getByRole('status')).toContainText('Unsaved changes on this page');

  await page.getByRole('link', { name: 'Next athlete' }).first().click();
  await expect(page.getByRole('heading', { name: 'Athlete D4E5F6' })).toBeVisible();
  await page.getByRole('link', { name: 'Previous athlete' }).first().click();
  await expect(page.getByLabel('Private evaluator note')).toHaveValue('Strong edge control');
  await expect(page.getByRole('radio', { name: 'Skating score 4 of 5' })).toBeChecked();

  await page.getByRole('button', { name: 'Complete evaluation' }).click();
  await expect(page.getByText('Choose a Compete score.')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Compete score' })).toBeFocused();
  await page.getByRole('radio', { name: 'Compete score 5 of 5' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on server');
  await page.getByRole('button', { name: 'Complete evaluation' }).click();
  await expect(page.getByRole('button', { name: 'Evaluation completed' })).toBeDisabled();

  await page.setViewportSize({ width: 320, height: 720 });
  const controls = await page
    .locator('main a, main button, main input[type="radio"], main input[type="checkbox"]')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const element = node as HTMLElement;
          return element.offsetParent !== null;
        })
        .map((node) => ({
          height: node.getBoundingClientRect().height,
          width: node.getBoundingClientRect().width,
        })),
    );
  expect(
    controls.every((control) => control.height >= 43.9),
    JSON.stringify(controls),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('states conflict and offline limits without overwriting the page draft', async ({
  context,
  page,
}) => {
  await page.goto('/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  const note = page.getByLabel('Private evaluator note');
  await note.fill('trigger conflict');
  await expect(page.getByRole('status')).toContainText('Server draft changed');
  await expect(note).toHaveValue('trigger conflict');
  await expect(page.getByRole('button', { name: 'Save now' })).toBeDisabled();

  await page.goto('/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  await context.setOffline(true);
  await page.getByLabel('Private evaluator note').fill('Page-only while disconnected');
  await expect(page.getByRole('status')).toContainText('Offline');
  await expect(page.getByRole('status')).toContainText('Changes remain on this page only');
  await context.setOffline(false);
});
