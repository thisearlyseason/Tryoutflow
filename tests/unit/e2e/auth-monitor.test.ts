// @vitest-environment node

import { EventEmitter } from 'node:events';

import type { Browser, BrowserContext, ConsoleMessage, Page } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { playwrightExpect } = vi.hoisted(() => ({
  playwrightExpect: vi.fn(),
}));

vi.mock('@playwright/test', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@playwright/test')>()),
  expect: playwrightExpect,
}));

import { openAuthenticatedContext, signInAs } from '../../../tests/e2e/helpers/auth';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'director@example.test',
  password: 'Task30-password!Aa',
  role: 'director',
};

function pageErrorConsole(text: string) {
  return {
    location: () => ({ url: 'http://127.0.0.1:3112/sign-in' }),
    text: () => text,
    type: () => 'error',
  } as ConsoleMessage;
}

class AuthPage extends EventEmitter {
  private currentUrl = 'about:blank';

  constructor(private readonly emitPreAuthError = true) {
    super();
  }

  async goto(path: string) {
    this.currentUrl = `http://127.0.0.1:3112${path}`;
    if (this.emitPreAuthError) this.emit('console', pageErrorConsole('pre-auth resource failed'));
  }

  context() {
    return { browser: () => ({ browserType: () => ({ name: () => 'chromium' }) }) };
  }

  getByLabel() {
    return { fill: vi.fn(async () => undefined) };
  }

  getByRole() {
    return {
      click: vi.fn(async () => {
        this.emit('request', {
          headers: () => ({ 'next-action': 'sign-in-action' }),
          method: () => 'POST',
          url: () => 'http://127.0.0.1:3112/sign-in',
        });
        this.currentUrl = 'http://127.0.0.1:3112/app/club/home';
        const homeRequest = {
          failure: () => ({ errorText: 'net::ERR_ABORTED' }),
          headers: () => ({ rsc: '1' }),
          method: () => 'GET',
          url: () => 'http://127.0.0.1:3112/app/club/home?_rsc=generated',
        };
        this.emit('request', homeRequest);
        this.emit('requestfailed', homeRequest);
      }),
    };
  }

  async waitForLoadState() {}

  url() {
    return this.currentUrl;
  }
}

describe('Task 30 authenticated browser monitoring', () => {
  beforeEach(() => {
    playwrightExpect.mockReset();
    playwrightExpect.mockReturnValue({ toHaveURL: vi.fn(async () => undefined) });
  });

  it('returns a monitor that retains errors from the first sign-in navigation', async () => {
    const page = new AuthPage();

    const monitor = await signInAs(page as unknown as Page, user, 'club');

    expect(() => monitor.assertClean()).toThrow(
      /unexpected console error: pre-auth resource failed/u,
    );
  });

  it('keeps first-navigation monitoring attached to a newly authenticated page', async () => {
    const page = new AuthPage();
    const context = {
      close: vi.fn(async () => undefined),
      newPage: vi.fn(async () => page as unknown as Page),
    } as unknown as BrowserContext;
    const browser = {
      newContext: vi.fn(async () => context),
    } as unknown as Browser;

    const opened = await openAuthenticatedContext({
      baseURL: 'http://127.0.0.1:3112',
      browser,
      organizationSlug: 'club',
      user,
    });

    expect(opened.page).toBe(page);
    expect(() => opened.monitor.assertClean()).toThrow(
      /unexpected console error: pre-auth resource failed/u,
    );
  });

  it('declares the exact Chromium home RSC cancellation before the sign-in action', async () => {
    const page = new AuthPage(false);

    const monitor = await signInAs(page as unknown as Page, user, 'club');

    expect(() => monitor.assertClean()).not.toThrow();
  });
});
