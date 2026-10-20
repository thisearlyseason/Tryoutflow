import { errors, expect, type Page } from '@playwright/test';

/** Durability scenarios accept the genuine autosave race, but never an obscured control. */
export async function saveEvaluationDraft(page: Page, destination: 'server' | 'device') {
  const button = page.getByRole('button', { name: 'Save now' });
  const confirmed = page.getByText(
    destination === 'server' ? 'Saved on server' : 'Saved on device',
    { exact: true },
  );
  await button.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  expect(
    await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return hit !== null && element.contains(hit);
    }),
    'the save control must be uncovered, even if autosave already completed',
  ).toBe(true);
  if (!(await button.isDisabled()) || !(await confirmed.isVisible())) {
    try {
      // One ordinary, hit-tested click. Autosave may confirm and disable the
      // button during actionability checks; do not wait the entire test for it.
      await button.click({ timeout: 2_000 });
    } catch (error) {
      if (
        !(error instanceof errors.TimeoutError) ||
        !(await button.isDisabled()) ||
        !(await confirmed.isVisible())
      ) {
        throw error;
      }
    }
  }
  await expect(confirmed).toBeVisible();
}
