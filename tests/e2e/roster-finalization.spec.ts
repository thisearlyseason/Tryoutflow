import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('builds by drag and keyboard, confirms release, finalizes, and revises without messaging', async ({
  isMobile,
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Accessible roster workspace' })).toBeVisible();
  await page.getByLabel('Select Athlete 42').check();
  await page.getByRole('button', { name: 'Move Athlete 42' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Destination team').selectOption({ label: 'White' });
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await expect(page.getByText('White roster 1 of 1')).toBeVisible();

  if (isMobile) {
    // Narrow touch viewports exercise the explicit control path; desktop engines exercise pointer DnD.
    await page.getByRole('button', { name: 'Move Athlete 42' }).click();
    await page.getByLabel('Destination team').selectOption({ label: 'Blue' });
    await page.getByRole('button', { name: 'Confirm move' }).click();
  } else {
    const dragHandle = page.getByRole('button', { name: 'Drag Athlete 42' });
    const destination = page.getByTestId('roster-destination-10000000-0000-4000-8000-000000000004');
    const sourceBox = await dragHandle.boundingBox();
    const destinationBox = await destination.boundingBox();
    if (!sourceBox || !destinationBox) throw new Error('roster drag targets must be visible');
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 10,
      sourceBox.y + sourceBox.height / 2,
      { steps: 2 },
    );
    await page.mouse.move(
      destinationBox.x + destinationBox.width / 2,
      destinationBox.y + destinationBox.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    // dnd-kit intentionally retains its document click suppressor for 50ms after a drop.
    await page.waitForTimeout(75);
  }
  await expect(page.getByText('Blue roster 2 of 2')).toBeVisible();

  await page.getByLabel('Bulk decision').selectOption('released');
  await page.getByRole('button', { name: 'Review decision for 1 athlete' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm bulk release' })).toContainText(
    'does not send a message',
  );
  await page.getByRole('button', { name: 'Confirm release' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No messages were sent' })).toBeVisible();

  await page.getByRole('button', { name: 'Finalize roster' }).click();
  const finalization = page.getByRole('dialog', { name: 'Finalize roster version' });
  await expect(finalization).toContainText('does not send athlete or guardian messages');
  await finalization.getByLabel('I understand this roster becomes immutable').check();
  await finalization.getByRole('button', { name: 'Confirm finalization' }).click();
  await expect(page.getByText('Finalized roster · immutable')).toBeVisible();
  await expect(page.getByText(/Recorded in the roster audit trail/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Athlete 42' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Create revision' }).click();
  const revision = page.getByRole('dialog', { name: 'Create roster revision' });
  await revision
    .getByLabel('Revision reason')
    .fill('Correcting a confirmed placement after director review.');
  await revision.getByRole('button', { name: 'Confirm revision' }).click();
  await expect(page.getByText('Draft roster · version 1')).toBeVisible();
  await expect(page.getByText('Roster revision 2')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/message sent|email delivered/i);
});

test('fails stale writes closed and provides one refresh-and-review path', async ({ page }) => {
  await page.goto('/stale');
  await page.getByRole('button', { name: 'Move Athlete 42' }).click();
  await page.getByLabel('Destination team').selectOption({ label: 'White' });
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Roster changed elsewhere' }),
  ).toContainText('Refresh and review version 9 before retrying');
  await expect(page.getByRole('button', { name: 'Refresh roster' })).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Roster changed elsewhere' }),
  ).toBeFocused();
  await expect(page.getByText('Athlete pool 1')).toBeVisible();
});

test('closes consequential dialogs and focuses stale recovery', async ({ page }) => {
  await page.goto('/stale');
  await page.getByLabel('Select Athlete 42').check();
  await page.getByRole('button', { name: 'Review decision for 1 athlete' }).click();
  await page.getByRole('button', { name: 'Confirm decisions' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Roster changed elsewhere' }),
  ).toBeFocused();

  await page.goto('/stale');
  await page.getByRole('button', { name: 'Finalize roster' }).click();
  await page.getByLabel('I understand this roster becomes immutable').check();
  await page.getByRole('button', { name: 'Confirm finalization' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Roster changed elsewhere' }),
  ).toBeFocused();

  await page.goto('/stale/revision');
  await page.getByRole('button', { name: 'Create revision' }).click();
  await page
    .getByLabel('Revision reason')
    .fill('Correcting a confirmed placement after director review.');
  await page.getByRole('button', { name: 'Confirm revision' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Roster changed elsewhere' }),
  ).toBeFocused();
});

test('keeps total roster and target counts truthful under position filters', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Filter by position').selectOption({ label: 'Goalie' });
  await expect(page.getByRole('heading', { name: 'Blue roster 1 of 2' })).toBeVisible();
  await expect(page.getByText('1 visible with this filter')).toBeVisible();
  await expect(page.getByText('Forward target 0 of 1')).toBeVisible();
  await expect(page.getByTestId('roster-destination-pool').getByRole('status')).toHaveText(
    'No athletes match this filter.',
  );
  await expect(
    page.getByTestId('roster-destination-10000000-0000-4000-8000-000000000005').getByRole('status'),
  ).toHaveText('No athletes assigned.');
});

test('has accessible 44px controls and no 320px horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const targets = await page
    .locator('main')
    .locator(
      'button, select, input:not([type="checkbox"]), textarea, label:has(input[type="checkbox"])',
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => ({
          label: (node as HTMLElement).innerText || (node as HTMLInputElement).name,
          height: node.getBoundingClientRect().height,
        })),
    );
  expect(
    targets.every(({ height }) => height >= 43.9),
    JSON.stringify(targets),
  ).toBe(true);
  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
});
