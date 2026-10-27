// @vitest-environment node

import { EventEmitter } from 'node:events';

import type { Browser, BrowserContext, ConsoleMessage, Page } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { playwrightExpect, workspaceVisible } = vi.hoisted(() => ({
  playwrightExpect: vi.fn(),
  workspaceVisible: vi.fn(),
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

  locator(selector: string) {
    return { selector };
  }

  url() {
    return this.currentUrl;
  }
}

describe('Task 30 authenticated browser monitoring', () => {
  beforeEach(() => {
    playwrightExpect.mockReset();
    workspaceVisible.mockReset().mockResolvedValue(undefined);
    playwrightExpect.mockReturnValue({
      toHaveURL: vi.fn(async () => undefined),
      toBeVisible: workspaceVisible,
    });
  });

  it('waits for authorized workspace content before returning to a caller that may navigate', async () => {
    let showWorkspace!: () => void;
    workspaceVisible.mockImplementationOnce(
      () => new Promise<void>((resolve) => (showWorkspace = resolve)),
    );
    let returned = false;
    const signingIn = signInAs(new AuthPage(false) as unknown as Page, user, 'club').then(
      (monitor) => {
        returned = true;
        return monitor;
      },
    );
    await vi.waitFor(() => expect(workspaceVisible).toHaveBeenCalledOnce());
    expect(playwrightExpect).toHaveBeenCalledWith({ selector: 'main#main-content' });
    expect(returned).toBe(false);
    showWorkspace();
    const monitor = await signingIn;
    expect(returned).toBe(true);
    expect(() => monitor.assertClean()).not.toThrow();
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
