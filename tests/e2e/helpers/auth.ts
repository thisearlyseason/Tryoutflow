import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';

import type { BrowserUser } from './fixtures';
import { monitorBrowserErrors, type BrowserErrorMonitor } from './network';

export async function signInAs(
  page: Page,
  user: BrowserUser,
  expectedOrganizationSlug?: string,
  monitor: BrowserErrorMonitor = monitorBrowserErrors(page),
  onBotToken?: (token: string) => void,
) {
  const isFirefox = page.context().browser()?.browserType().name() === 'firefox';
  const iconResponses: Response[] = [];
  const captureIconResponse = (response: Response) => {
    if (
      response.request().method() === 'GET' &&
      response.request().resourceType() === 'image' &&
      new URL(response.url()).pathname === '/icon.svg'
    )
      iconResponses.push(response);
  };
  // Capture before navigation: Firefox may finish the favicon before goto resolves.
  if (isFirefox) page.on('response', captureIconResponse);
  try {
    await page.goto('/sign-in');
    if (isFirefox) {
      const iconHref = await page
        .locator('link[rel="icon"][type="image/svg+xml"]')
        .getAttribute('href');
      expect(iconHref, 'the generated SVG favicon is declared').not.toBeNull();
      const iconUrl = new URL(iconHref!, page.url());
      expect(iconUrl.origin).toBe(new URL(page.url()).origin);
      expect(iconUrl.pathname).toBe('/icon.svg');
      const isDeclaredIcon = (response: Response) =>
        response.url() === iconUrl.href &&
        response.request().method() === 'GET' &&
        response.request().resourceType() === 'image';
      // Verify the response Firefox actually loads, including a browser cache hit.
      // No separate Node transport request or retry is needed to verify this asset.
      const iconResponse =
        iconResponses.find(isDeclaredIcon) ?? (await page.waitForResponse(isDeclaredIcon));
      expect(iconResponse.ok(), 'the exact favicon is served successfully').toBe(true);
      expect(iconResponse.headers()['content-type']).toContain('image/svg+xml');
      await iconResponse.body();
      expect(
        iconResponse.request().failure(),
        'the exact favicon finishes before sign-in',
      ).toBeNull();
      // Firefox can cancel a subsequent chrome favicon request on navigation.
      // Bound this to one image request for the exact successfully loaded URL;
      // failed assets, application requests, other errors, and repeats still fail.
      monitor.allowOptionalRequestFailure({
        errorText: 'NS_BINDING_ABORTED',
        headers: { 'sec-fetch-dest': 'image' },
        label: 'one Firefox navigation cancellation of the verified SVG favicon',
        maxCount: 1,
        method: 'GET',
        url: iconUrl.href,
      });
    }
  } finally {
    if (isFirefox) page.off('response', captureIconResponse);
  }
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  if (onBotToken) {
    onBotToken(await page.locator('input[name="cf-turnstile-response"]').inputValue());
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (expectedOrganizationSlug) {
    await expect(page).toHaveURL(new RegExp(`/app/${expectedOrganizationSlug}/home$`, 'u'));
    await page.waitForLoadState('networkidle');
    return monitor;
  }
  await expect(page).toHaveURL(/\/app(?:\/|$)|\/start$/u);
  await page.waitForLoadState('networkidle');
  return monitor;
}

export async function openAuthenticatedContext(input: {
  browser: Browser;
  baseURL: string;
  user: BrowserUser;
  organizationSlug: string;
  locale?: string;
  timezoneId?: string;
}) {
  const context = await input.browser.newContext({
    baseURL: input.baseURL,
    locale: input.locale ?? 'en-CA',
    timezoneId: input.timezoneId ?? 'America/Edmonton',
  });
  const page = await context.newPage();
  try {
    const monitor = await signInAs(page, input.user, input.organizationSlug);
    return { context, monitor, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function clearAuthenticatedSession(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}
