import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { BrowserUser } from './fixtures';
import { monitorBrowserErrors, type BrowserErrorMonitor } from './network';

export async function signInAs(
  page: Page,
  user: BrowserUser,
  expectedOrganizationSlug?: string,
  monitor: BrowserErrorMonitor = monitorBrowserErrors(page),
) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
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
