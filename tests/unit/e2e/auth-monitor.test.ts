// @vitest-environment node

import { EventEmitter } from 'node:events';

import type { Browser, BrowserContext, ConsoleMessage, Page, Response } from '@playwright/test';
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
        this.currentUrl = 'http://127.0.0.1:3112/app/club/home';
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
    playwrightExpect.mockImplementation((value, message) =>
      value instanceof AuthPage
        ? { toHaveURL: vi.fn(async () => undefined) }
        : expect(value, message),
    );
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

  it('does not declare cancellable requests for the ordinary sign-in POST route', async () => {
    const page = new AuthPage(false);

    const monitor = await signInAs(page as unknown as Page, user, 'club');

    expect(() => monitor.assertClean()).not.toThrow();
  });
});

type FaviconCase = {
  arrival?: 'during-navigation' | 'after-navigation' | 'missing';
  contentType?: string | null;
  bodyError?: Error;
  requestFailure?: string;
  href?: string | null;
  method?: string;
  resourceType?: string;
  responseUrl?: string;
  status?: number;
};

const iconUrl = 'http://127.0.0.1:3112/icon.svg?icon.exact-build.svg';

class FirefoxAuthPage extends AuthPage {
  readonly apiGet = vi.fn(async () => {
    throw new Error('the browser response must not create a duplicate API request');
  });
  readonly request = { get: this.apiGet };
  readonly fill = vi.fn(async () => undefined);
  readonly click = vi.fn(async () => super.getByRole().click());
  readonly iconResponse: Response;
  readonly waitForResponse = vi.fn(async (predicate: (response: Response) => boolean) => {
    if (this.input.arrival === 'missing' || !predicate(this.iconResponse))
      throw new Error('no browser response for the exact declared favicon');
    this.emit('response', this.iconResponse);
    return this.iconResponse;
  });

  constructor(private readonly input: FaviconCase = {}) {
    super(false);
    const status = input.status ?? 200;
    this.iconResponse = {
      body: vi.fn(async () => {
        if (input.bodyError) throw input.bodyError;
        return Buffer.from('<svg/>');
      }),
      headers: () =>
        input.contentType === null
          ? {}
          : { 'content-type': input.contentType ?? 'image/svg+xml; charset=utf-8' },
      ok: () => status >= 200 && status <= 299,
      request: () => ({
        method: () => input.method ?? 'GET',
        resourceType: () => input.resourceType ?? 'image',
        failure: () => (input.requestFailure ? { errorText: input.requestFailure } : null),
      }),
      url: () => input.responseUrl ?? iconUrl,
    } as unknown as Response;
  }

  context() {
    return { browser: () => ({ browserType: () => ({ name: () => 'firefox' }) }) };
  }

  async goto(path: string) {
    await super.goto(path);
    if (!this.input.arrival || this.input.arrival === 'during-navigation')
      this.emit('response', this.iconResponse);
  }

  locator() {
    return {
      getAttribute: vi.fn(async () =>
        'href' in this.input ? this.input.href : '/icon.svg?icon.exact-build.svg',
      ),
    };
  }

  getByLabel() {
    return { fill: this.fill };
  }

  getByRole() {
    return { click: this.click };
  }
}

describe('Firefox sign-in favicon response verification', () => {
  beforeEach(() => {
    playwrightExpect.mockReset();
    playwrightExpect.mockImplementation((value, message) =>
      value instanceof AuthPage
        ? { toHaveURL: vi.fn(async () => undefined) }
        : expect(value, message),
    );
  });

  it.each(['during-navigation', 'after-navigation'] as const)(
    'verifies the actual browser response arriving %s with zero duplicate requests',
    async (arrival) => {
      const page = new FirefoxAuthPage({ arrival });
      const monitor = await signInAs(page as unknown as Page, user, 'club');
      expect(page.apiGet).not.toHaveBeenCalled();
      expect(page.iconResponse.body).toHaveBeenCalledOnce();
      expect(page.waitForResponse).toHaveBeenCalledTimes(arrival === 'after-navigation' ? 1 : 0);
      expect(page.listenerCount('response')).toBe(0);
      expect(page.click).toHaveBeenCalledOnce();
      expect(() => monitor.assertClean()).not.toThrow();
    },
  );

  it.each([
    ['missing declaration', { href: null }],
    [
      'cross-origin declaration',
      { href: 'https://other.example.test/icon.svg?icon.exact-build.svg' },
    ],
    ['wrong declared path', { href: '/favicon.ico' }],
    ['other build response', { responseUrl: iconUrl.replace('exact-build', 'other-build') }],
    ['non-GET response', { method: 'POST' }],
    ['non-image response', { resourceType: 'fetch' }],
    ['HTTP404', { status: 404 }],
    ['HTTP503', { status: 503 }],
    ['incorrect content type', { contentType: 'text/html' }],
    ['missing content type', { contentType: null }],
    ['incomplete body', { bodyError: new Error('NS_BINDING_ABORTED') }],
    ['failed request despite available body', { requestFailure: 'NS_BINDING_ABORTED' }],
    ['no browser response', { arrival: 'missing' }],
  ] satisfies Array<[string, FaviconCase]>)(
    'rejects %s before allowing favicon cancellation or submitting sign-in',
    async (_name, input) => {
      const page = new FirefoxAuthPage(input);
      const allowOptionalRequestFailure = vi.fn();
      await expect(
        signInAs(page as unknown as Page, user, 'club', {
          allowOptionalRequestFailure,
        } as unknown as import('../../../tests/e2e/helpers/network').BrowserErrorMonitor),
      ).rejects.toThrow();
      expect(page.apiGet).not.toHaveBeenCalled();
      expect(page.fill).not.toHaveBeenCalled();
      expect(page.click).not.toHaveBeenCalled();
      expect(allowOptionalRequestFailure).not.toHaveBeenCalled();
      expect(page.listenerCount('response')).toBe(0);
    },
  );

  it('keeps the verified cancellation allowance exact and bounded to one', async () => {
    const page = new FirefoxAuthPage();
    const monitor = await signInAs(page as unknown as Page, user, 'club');
    const cancelled = {
      failure: () => ({ errorText: 'NS_BINDING_ABORTED' }),
      headers: () => ({ 'sec-fetch-dest': 'image' }),
      method: () => 'GET',
      url: () => iconUrl,
    };
    page.emit('requestfailed', cancelled);
    expect(() => monitor.assertClean()).not.toThrow();
    page.emit('requestfailed', cancelled);
    expect(() => monitor.assertClean()).toThrow(/unexpected request failure/u);
  });
});
