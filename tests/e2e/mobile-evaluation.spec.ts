import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('scores assigned athletes one-handed without losing an in-page draft', async ({ page }) => {
  await page.goto('/cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await expect(page.getByRole('heading', { name: 'Athlete A1B2C3' })).toBeVisible();
  await expect(page.getByText('#42')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Ava Smith');

  const skating = page.getByRole('radio', { name: 'Skating score 3 of 5' });
  await expect(skating).toBeEnabled();
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
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('states conflict and offline limits without overwriting the page draft', async ({
  context,
  page,
}) => {
  await page.goto('/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  const note = page.getByLabel('Private evaluator note');
  await expect(note).toBeEnabled();
  await note.fill('trigger conflict');
  await expect(page.getByRole('status')).toContainText('Server draft changed');
  await expect(note).toHaveValue('trigger conflict');
  await expect(page.getByRole('button', { name: 'Save now' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review local and server drafts' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Local draft' })).toContainText(
    'trigger conflict',
  );
  await expect(page.getByRole('button', { name: 'Copy local draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download local draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save now' })).toBeDisabled();
  await page.getByRole('button', { name: 'Keep my local draft' }).click();
  await note.fill('resolved local draft');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on server');

  await page.goto('/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  await expect(page.getByLabel('Private evaluator note')).toBeEnabled();
  let mutationRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/evaluations/') && request.method() === 'POST') {
      mutationRequests += 1;
    }
  });
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'Skating score 4 of 5' }).click();
  await page.getByLabel('Private evaluator note').fill('Durable rink-side draft');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on device');
  expect(mutationRequests).toBe(0);
  await page.evaluate(async () => {
    const database = (await indexedDB.databases()).find((candidate) =>
      candidate.name?.startsWith('tryoutflow-evaluations--u-'),
    );
    if (!database?.name) throw new Error('Expected the physical evaluator database.');
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(database.name!);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const connection = request.result;
        const transaction = connection.transaction('mutations', 'readwrite');
        transaction.objectStore('mutations').clear();
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
          connection.close();
          resolve();
        };
      };
    });
  });
  await context.setOffline(false);
  await page.route('**/api/evaluations/**', (route) => route.abort('failed'));
  await page.reload();
  await expect(page.getByLabel('Private evaluator note')).toHaveValue('Durable rink-side draft');
  await expect(page.getByRole('status')).toContainText('Saved on device');
  await expect(page.getByRole('button', { name: 'Complete evaluation' })).toBeDisabled();
  mutationRequests = 0;
  await page.unroute('**/api/evaluations/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status')).toContainText('Saved on server');
  expect(mutationRequests).toBe(1);
  await page.reload();
  await expect(page.getByLabel('Private evaluator note')).toHaveValue('Durable rink-side draft');
  await page.getByLabel('Private evaluator note').fill('force server conflict');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('heading', { name: 'Review local and server drafts' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Local draft' })).toContainText(
    'force server conflict',
  );
});

test('durably resolves synchronized conflicts without resurrecting discarded work', async ({
  context,
  page,
}) => {
  let releaseConflict!: () => void;
  const holdConflict = new Promise<void>((resolve) => {
    releaseConflict = resolve;
  });
  let reportConflictRequest!: () => void;
  const conflictRequested = new Promise<void>((resolve) => {
    reportConflictRequest = resolve;
  });
  let heldConflict = false;
  await page.route('**/api/evaluations/**', async (route) => {
    const requestBody = route.request().postDataJSON() as { draft?: { note?: string } };
    if (!heldConflict && requestBody.draft?.note?.startsWith('force durable conflict keep local')) {
      heldConflict = true;
      const response = await route.fetch();
      reportConflictRequest();
      await holdConflict;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  const mutationUrls: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/evaluations/'))
      mutationUrls.push(request.url());
  });
  await page.goto('/abababab-abab-4bab-8bab-abababababab');
  const note = page.getByLabel('Private evaluator note');
  await page.getByRole('radio', { name: 'Skating score 4 of 5' }).click();
  await page.getByRole('radio', { name: 'Compete score 4 of 5' }).click();
  await note.fill('force durable conflict keep local');
  await page.getByRole('button', { name: 'Save now' }).click();
  await conflictRequested;
  await note.fill('newest edit behind durable conflict');
  releaseConflict();
  await expect(page.getByRole('heading', { name: 'Review local and server drafts' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Local draft' })).toContainText(
    'newest edit behind durable conflict',
  );
  await page.reload();
  await expect(note).toHaveValue('newest edit behind durable conflict');
  await expect(page.getByRole('button', { name: 'Keep my local draft' })).toBeEnabled();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Keep my local draft' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on device');
  await expect(page.getByRole('button', { name: 'Complete evaluation' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('status')).toContainText('Saved on server');
  await expect(note).toHaveValue('newest edit behind durable conflict');
  expect(mutationUrls.some((url) => url.includes('edededed-eded-4ede-8ede-edededededed'))).toBe(
    true,
  );
  await note.fill('edited after durable keep-local resolution');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on server');
  await page.reload();
  await expect(note).toHaveValue('edited after durable keep-local resolution');

  await page.goto('/acacacac-acac-4cac-8cac-acacacacacac');
  const discarded = page.getByLabel('Private evaluator note');
  await discarded.fill('force durable conflict discard this');
  await page.getByRole('button', { name: 'Save now' }).click();
  await expect(page.getByRole('heading', { name: 'Review local and server drafts' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Use server draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Use server draft' }).click();
  await expect(discarded).toHaveValue('');
  await page.reload();
  await expect(discarded).toHaveValue('');
  await expect(page.getByText('force durable conflict discard this')).toHaveCount(0);
});
