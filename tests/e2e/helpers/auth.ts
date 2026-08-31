import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { BrowserUser } from './fixtures';

export async function signInAs(page: Page, user: BrowserUser, expectedOrganizationSlug?: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (expectedOrganizationSlug) {
    await expect(page).toHaveURL(new RegExp(`/app/${expectedOrganizationSlug}/home$`, 'u'));
    await page.waitForLoadState('networkidle');
    return;
  }
  await expect(page).toHaveURL(/\/app(?:\/|$)|\/start$/u);
  await page.waitForLoadState('networkidle');
}

export async function openAuthenticatedContext(input: {
  browser: Browser;
  baseURL: string;
  user: BrowserUser;
  organizationSlug: string;
  locale?: string;
  timezoneId?: string;
}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await input.browser.newContext({
    baseURL: input.baseURL,
    locale: input.locale ?? 'en-CA',
    timezoneId: input.timezoneId ?? 'America/Edmonton',
  });
  const page = await context.newPage();
  try {
    await signInAs(page, input.user, input.organizationSlug);
    return { context, page };
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
