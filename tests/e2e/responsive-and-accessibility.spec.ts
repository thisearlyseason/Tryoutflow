import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { signInAs } from './helpers/auth';
import { expect, test } from './helpers/fixtures';
import { monitorBrowserErrors } from './helpers/network';

async function expectNoOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
}

async function expectMinimumTouchTargets(locator: Locator) {
  const targets = await locator.evaluateAll((nodes) =>
    nodes
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => ({
        label:
          node.getAttribute('aria-label') ??
          (node as HTMLElement).innerText ??
          (node as HTMLInputElement).name,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
      })),
  );
  expect(targets.length).toBeGreaterThan(0);
  expect(
    targets.every(({ width, height }) => width >= 43.9 && height >= 43.9),
    JSON.stringify(targets),
  ).toBe(true);
}

async function expectAxeClean(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
}

test('scenario 13 — evaluator at 375px keeps save/navigation reachable, 44px controls, focus, axe, and reduced motion', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=evaluator-three; organization=${scenario.organizationSlug}; tryout=${scenario.tryoutName} (${scenario.ids.tryout}); viewport=375x812`,
  });
  const monitor = monitorBrowserErrors(page);
  monitor.allowRequestFailure(/\/app\/[^/]+\/evaluate(?:\/|\?).*[?&]_rsc=/u);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAs(page, scenario.users.evaluatorThree, scenario.organizationSlug);
  await page.goto(
    `/app/${scenario.organizationSlug}/evaluate/session/${scenario.ids.session}/athletes/${scenario.ids.registrationD}`,
  );
  await expect(page.getByRole('heading', { name: 'Offline Rinkside' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save now' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Complete evaluation' })).toBeInViewport();
  await page.getByRole('radio', { name: 'Control score 2 of 10' }).focus();
  await expect(page.getByRole('radio', { name: 'Control score 2 of 10' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Control score 3 of 10' })).toBeChecked();
  await expectMinimumTouchTargets(
    page.locator('main a, main button, main input[type="radio"], main input[type="checkbox"]'),
  );
  await expectNoOverflow(page);
  await expectAxeClean(page);
  const moving = await page.locator('main button, main a').evaluateAll((nodes) =>
    nodes
      .filter((node) => (node as HTMLElement).offsetParent !== null)
      .map((node) => {
        const style = getComputedStyle(node);
        return `${style.animationDuration}|${style.transitionDuration}`;
      }),
  );
  expect(
    moving.every((duration) =>
      /^(?:0s|0ms)(?:, (?:0s|0ms))*\|(?:0s|0ms)(?:, (?:0s|0ms))*$/u.test(duration),
    ),
  ).toBe(true);
  monitor.assertClean();
});

test('narrow roster supports keyboard movement, consequential focus, 44px controls, no overflow, and axe', async ({
  page,
  scenario,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description: `role=director; organization=${scenario.organizationSlug}; tryout=${scenario.tryoutName} (${scenario.ids.tryout}); roster=${scenario.ids.draftRoster}; viewport=390x844`,
  });
  const monitor = monitorBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, scenario.users.director, scenario.organizationSlug);
  await page.goto(
    `/app/${scenario.organizationSlug}/tryouts/${scenario.ids.tryout}/rosters?division=${scenario.ids.rosterDivision}`,
  );
  const move = page.getByRole('button', { name: 'Move Roster Mover' });
  await move.focus();
  await expect(move).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Move Roster Mover' })).toBeVisible();
  await expect(page.getByLabel('Destination team')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(move).toBeFocused();
  await page.getByRole('button', { name: 'Finalize roster' }).click();
  const finalization = page.getByRole('dialog', { name: 'Finalize roster version' });
  await expect(finalization).toBeVisible();
  await expect(finalization.getByLabel('I understand this roster becomes immutable')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Finalize roster' })).toBeFocused();
  await expectMinimumTouchTargets(
    page.locator(
      'main button, main select, main input:not([type="checkbox"]), main textarea, main label:has(input[type="checkbox"])',
    ),
  );
  await expectNoOverflow(page);
  await expectAxeClean(page);
  monitor.assertClean();
});

test('marketing and authentication remain keyboard-first, 44px, overflow-free, axe-clean, and hydration-clean at 430px', async ({
  page,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'scope',
    description:
      'role=anonymous; organization=none; tryout=none; routes=/ and /sign-in; viewport=430x932',
  });
  const monitor = monitorBrowserErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expectMinimumTouchTargets(
    page.locator('header a, header button, main a, main button, footer a, footer button'),
  );
  await expectNoOverflow(page);
  await expectAxeClean(page);

  await page.goto('/sign-in');
  await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  await page.getByLabel('Email').focus();
  await expect(page.getByLabel('Email')).toBeFocused();
  await expectMinimumTouchTargets(page.locator('main input, main button, main a'));
  await expectNoOverflow(page);
  await expectAxeClean(page);
  monitor.assertClean();
});
