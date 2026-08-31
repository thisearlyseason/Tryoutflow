import type { BrowserContext, Page, Request, Route } from '@playwright/test';
import { expect } from '@playwright/test';

type RequestMatcher = (request: Request) => boolean;

export type BrowserErrorMonitor = Readonly<{
  allowConsoleError(pattern: RegExp): void;
  allowRequestFailure(pattern: RegExp): void;
  assertClean(): void;
}>;

export function monitorBrowserErrors(page: Page): BrowserErrorMonitor {
  const failures: string[] = [];
  const allowedConsoleErrors: RegExp[] = [];
  const allowedFailures: RegExp[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !allowedConsoleErrors.some((pattern) => pattern.test(message.text()))
    )
      failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    if (allowedFailures.some((pattern) => pattern.test(request.url()))) return;
    if (request.url().includes('_rsc=') && request.failure()?.errorText === 'net::ERR_ABORTED') {
      return;
    }
    failures.push(
      `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    );
  });
  return {
    allowConsoleError(pattern) {
      allowedConsoleErrors.push(pattern);
    },
    allowRequestFailure(pattern) {
      allowedFailures.push(pattern);
    },
    assertClean() {
      expect(failures, failures.join('\n')).toEqual([]);
    },
  };
}

export async function setOffline(context: BrowserContext) {
  await context.setOffline(true);
}

export async function reconnect(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

export async function loseResponseAfterApplicationCommit(page: Page, matcher: RequestMatcher) {
  let used = false;
  await page.route('**/*', async (route) => {
    if (used || !matcher(route.request())) return route.fallback();
    used = true;
    await route.fetch();
    await route.abort('failed');
  });
  return async () => {
    await page.unroute('**/*');
    expect(used, 'the application-boundary response-loss route was exercised').toBe(true);
  };
}

export async function holdResponseAfterApplicationCommit(page: Page, matcher: RequestMatcher) {
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (reached = resolve));
  let used = false;
  await page.route('**/*', async (route: Route) => {
    if (used || !matcher(route.request())) return route.fallback();
    used = true;
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response });
  });
  return {
    requested,
    release,
    async cleanup() {
      release();
      await page.unroute('**/*');
      expect(used, 'the application-boundary delayed-response route was exercised').toBe(true);
    },
  };
}

export function isEvaluationMutation(request: Request) {
  return (
    request.method() === 'POST' && /\/api\/evaluations\/[^/]+\/mutations$/u.test(request.url())
  );
}
