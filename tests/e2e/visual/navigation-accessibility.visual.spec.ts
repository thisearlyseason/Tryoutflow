import { test, expect } from '@playwright/test';
import { signInDemoOwner, openDemoTryout } from '../helpers/visual';

test('desktop sidebar keeps Audit Settings Billing reachable', async ({ page }) => {
  await signInDemoOwner(page);
  const results = [];
  for (const [label, heading] of [
    ['Audit', 'Audit history'],
    ['Settings', 'Organization settings'],
    ['Billing', 'Billing'],
  ]) {
    const nav = page.locator('.app-sidebar .app-navigation');
    const link = nav.getByRole('link', { name: label, exact: true });
    await link.scrollIntoViewIfNeeded();
    await link.focus();
    const bounds = await link.boundingBox(),
      region = await nav.boundingBox();
    expect(bounds).not.toBeNull();
    expect(region).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(region!.y - 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(region!.y + region!.height + 1);
    results.push({ label, visible: true });
    await link.click();
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
  }
  await test.info().attach('sidebar-reachability', {
    body: JSON.stringify(results),
    contentType: 'application/json',
  });
});

test('mobile bottom navigation does not permanently occlude main focus targets', async ({
  page,
}) => {
  await signInDemoOwner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const results = [];
  for (const route of [
    '/app/badlands-hockey-academy/organization/billing',
    '/app/badlands-hockey-academy/tryouts',
  ]) {
    await page.goto(route);
    if (route.endsWith('/tryouts')) await openDemoTryout(page);
    await expect(page.getByRole('main')).toBeVisible();
    const targets = page.locator(
      'main a[href], main button:not([disabled]), main input:not([type=hidden]):not([disabled]), main select:not([disabled])',
    );
    let checked = 0;
    for (let i = 0; i < (await targets.count()); i++) {
      const target = targets.nth(i);
      if (!(await target.isVisible())) continue;
      await target.focus();
      await expect(target).toBeFocused();
      const box = await target.boundingBox(),
        bottom = await page.locator('.mobile-nav-bar').boundingBox(),
        top = await page.locator('.mobile-organization').boundingBox();
      expect(box).not.toBeNull();
      expect(bottom).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(bottom!.y + 1);
      if (top) expect(box!.y).toBeGreaterThanOrEqual(top.y + top.height - 1);
      checked++;
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    results.push({ route, focusTargets: checked });
  }
  await test.info().attach('mobile-focus-reachability', {
    body: JSON.stringify(results),
    contentType: 'application/json',
  });
});
