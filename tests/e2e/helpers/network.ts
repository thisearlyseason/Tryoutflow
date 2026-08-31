import type { BrowserContext, ConsoleMessage, Page, Request, Route } from '@playwright/test';
import { expect } from '@playwright/test';

type RequestMatcher = (request: Request) => boolean;
type TextMatcher = string | RegExp;
const browserCancellationErrors = [
  'net::ERR_ABORTED',
  'NS_BINDING_ABORTED',
  'NS_ERROR_ABORT',
  'cancelled',
] as const;

type CountedExpectation = Readonly<{
  count: number;
  label: string;
}>;

export type ExpectedRequestFailure = CountedExpectation &
  Readonly<{
    errorText: string | readonly string[];
    headers?: Readonly<Record<string, TextMatcher>>;
    method: string;
    url: TextMatcher;
  }>;

export type ExpectedCancellableRequest = ExpectedRequestFailure;

export type ExpectedRscCancellation = CountedExpectation &
  Readonly<{
    errorText: string | readonly string[];
    headers: Readonly<Record<string, TextMatcher> & { rsc: '1' }>;
    method: 'GET';
    /** Exact absolute application URL before Next.js adds its generated `_rsc` token. */
    url: string;
  }>;

export type ExpectedCancellableRscRequest = ExpectedRscCancellation;

export type ExpectedConsoleError = CountedExpectation &
  Readonly<{
    text: TextMatcher;
    url?: TextMatcher;
  }>;

export type BrowserErrorMonitor = Readonly<{
  expectCancellableRequest(expectation: ExpectedCancellableRequest): void;
  expectCancellableRscRequest(expectation: ExpectedCancellableRscRequest): void;
  expectConsoleError(expectation: ExpectedConsoleError): void;
  expectRequestFailure(expectation: ExpectedRequestFailure): void;
  expectRscCancellation(expectation: ExpectedRscCancellation): void;
  assertClean(): void;
  stop(): void;
}>;

function matches(value: string, matcher: TextMatcher) {
  if (typeof matcher === 'string') return value === matcher;
  matcher.lastIndex = 0;
  return matcher.test(value);
}

function validExpectation(expectation: CountedExpectation) {
  if (!Number.isSafeInteger(expectation.count) || expectation.count < 1)
    throw new Error(`invalid expected count for ${expectation.label}`);
  if (expectation.label.trim().length === 0) throw new Error('expected failure needs a label');
}

function matchesGeneratedRscUrl(requestUrl: string, expectedApplicationUrl: string) {
  try {
    const actual = new URL(requestUrl);
    const expected = new URL(expectedApplicationUrl);
    const tokens = actual.searchParams.getAll('_rsc');
    if (expected.searchParams.has('_rsc') || tokens.length !== 1 || tokens[0]?.length === 0) {
      return false;
    }
    actual.searchParams.delete('_rsc');
    actual.search = actual.searchParams.toString();
    expected.search = expected.searchParams.toString();
    return actual.href === expected.href;
  } catch {
    return false;
  }
}

export function monitorBrowserErrors(page: Page): BrowserErrorMonitor {
  const failures: string[] = [];
  const consoleExpectations: Array<ExpectedConsoleError & { consumed: number }> = [];
  const cancellableExpectations: Array<ExpectedCancellableRequest & { consumed: number }> = [];
  const cancellableRequests = new WeakMap<Request, ExpectedCancellableRequest>();
  const cancellableRscExpectations: Array<ExpectedCancellableRscRequest & { consumed: number }> =
    [];
  const cancellableRscRequests = new WeakMap<Request, ExpectedCancellableRscRequest>();
  const requestExpectations: Array<ExpectedRequestFailure & { consumed: number }> = [];
  const rscExpectations: Array<ExpectedRscCancellation & { consumed: number }> = [];
  const rscRequests = new WeakMap<
    Request,
    {
      expectation: ExpectedRscCancellation & { consumed: number };
      resolvedUrl: string;
    }
  >();
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const url = message.location().url;
    const expectation = consoleExpectations.find(
      (candidate) =>
        candidate.consumed < candidate.count &&
        matches(text, candidate.text) &&
        (candidate.url === undefined || matches(url, candidate.url)),
    );
    if (expectation) {
      expectation.consumed += 1;
      return;
    }
    failures.push(`unexpected console error: ${text}${url ? ` (${url})` : ''}`);
  };
  const onPageError = (error: Error) => failures.push(`pageerror: ${error.message}`);
  const requestMatches = (
    request: Request,
    candidate: Pick<ExpectedRequestFailure, 'headers' | 'method' | 'url'>,
  ) =>
    candidate.method === request.method() &&
    matches(request.url(), candidate.url) &&
    Object.entries(candidate.headers ?? {}).every(([name, expected]) =>
      matches(request.headers()[name] ?? '', expected),
    );
  const onRequest = (request: Request) => {
    const expectation = cancellableExpectations.find(
      (candidate) => candidate.consumed < candidate.count && requestMatches(request, candidate),
    );
    if (expectation) {
      expectation.consumed += 1;
      cancellableRequests.set(request, expectation);
      return;
    }
    if (cancellableExpectations.some((candidate) => requestMatches(request, candidate))) {
      failures.push(`unexpected declared request: ${request.method()} ${request.url()}`);
      return;
    }
    const cancellableRscExpectation = cancellableRscExpectations.find(
      (candidate) =>
        candidate.consumed < candidate.count &&
        candidate.method === request.method() &&
        matchesGeneratedRscUrl(request.url(), candidate.url) &&
        Object.entries(candidate.headers).every(([name, expected]) =>
          matches(request.headers()[name] ?? '', expected),
        ),
    );
    if (cancellableRscExpectation) {
      cancellableRscExpectation.consumed += 1;
      cancellableRscRequests.set(request, cancellableRscExpectation);
      return;
    }
    if (
      cancellableRscExpectations.some(
        (candidate) =>
          candidate.method === request.method() &&
          matchesGeneratedRscUrl(request.url(), candidate.url) &&
          Object.entries(candidate.headers).every(([name, expected]) =>
            matches(request.headers()[name] ?? '', expected),
          ),
      )
    ) {
      failures.push(`unexpected declared RSC request: ${request.method()} ${request.url()}`);
      return;
    }
    const rscExpectation = rscExpectations.find(
      (candidate) =>
        candidate.consumed < candidate.count &&
        candidate.method === request.method() &&
        matchesGeneratedRscUrl(request.url(), candidate.url) &&
        Object.entries(candidate.headers).every(([name, expected]) =>
          matches(request.headers()[name] ?? '', expected),
        ),
    );
    if (rscExpectation) {
      rscRequests.set(request, { expectation: rscExpectation, resolvedUrl: request.url() });
    }
  };
  const onRequestFailed = (request: Request) => {
    const method = request.method();
    const url = request.url();
    const errorText = request.failure()?.errorText ?? '';
    const headers = request.headers();
    const cancellable = cancellableRequests.get(request);
    if (cancellable) {
      const allowed =
        typeof cancellable.errorText === 'string'
          ? errorText === cancellable.errorText
          : cancellable.errorText.includes(errorText);
      if (allowed) return;
      failures.push(
        `unexpected cancellation error: ${method} ${url} ${errorText} (${cancellable.label})`,
      );
      return;
    }
    const cancellableRsc = cancellableRscRequests.get(request);
    if (cancellableRsc) {
      const allowed =
        typeof cancellableRsc.errorText === 'string'
          ? errorText === cancellableRsc.errorText
          : cancellableRsc.errorText.includes(errorText);
      if (allowed) return;
      failures.push(
        `unexpected RSC cancellation: ${method} ${url} ${errorText} (${cancellableRsc.label})`,
      );
      return;
    }
    const rsc = rscRequests.get(request);
    if (rsc) {
      const allowed =
        typeof rsc.expectation.errorText === 'string'
          ? errorText === rsc.expectation.errorText
          : rsc.expectation.errorText.includes(errorText);
      if (allowed && rsc.resolvedUrl === url && rsc.expectation.consumed < rsc.expectation.count) {
        rsc.expectation.consumed += 1;
        return;
      }
      failures.push(
        `unexpected RSC cancellation: ${method} ${url} ${errorText} (${rsc.expectation.label})`,
      );
      return;
    }
    const expectation = requestExpectations.find(
      (candidate) =>
        candidate.consumed < candidate.count &&
        candidate.method === method &&
        matches(url, candidate.url) &&
        (typeof candidate.errorText === 'string'
          ? errorText === candidate.errorText
          : candidate.errorText.includes(errorText)) &&
        Object.entries(candidate.headers ?? {}).every(([name, expected]) =>
          matches(headers[name] ?? '', expected),
        ),
    );
    if (expectation) {
      expectation.consumed += 1;
      return;
    }
    failures.push(`unexpected request failure: ${method} ${url} ${errorText}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('request', onRequest);
  page.on('requestfailed', onRequestFailed);
  return {
    expectCancellableRequest(expectation) {
      validExpectation(expectation);
      cancellableExpectations.push({ ...expectation, consumed: 0 });
    },
    expectCancellableRscRequest(expectation) {
      validExpectation(expectation);
      const declared = new URL(expectation.url);
      if (declared.searchParams.has('_rsc')) {
        throw new Error(`RSC expectation must omit the generated _rsc token: ${expectation.label}`);
      }
      cancellableRscExpectations.push({ ...expectation, consumed: 0 });
    },
    expectConsoleError(expectation) {
      validExpectation(expectation);
      consoleExpectations.push({ ...expectation, consumed: 0 });
    },
    expectRequestFailure(expectation) {
      validExpectation(expectation);
      requestExpectations.push({ ...expectation, consumed: 0 });
    },
    expectRscCancellation(expectation) {
      validExpectation(expectation);
      const declared = new URL(expectation.url);
      if (declared.searchParams.has('_rsc')) {
        throw new Error(`RSC expectation must omit the generated _rsc token: ${expectation.label}`);
      }
      rscExpectations.push({ ...expectation, consumed: 0 });
    },
    assertClean() {
      const missing = [
        ...consoleExpectations,
        ...cancellableExpectations,
        ...cancellableRscExpectations,
        ...requestExpectations,
        ...rscExpectations,
      ]
        .filter((expectation) => expectation.consumed !== expectation.count)
        .map(
          (expectation) =>
            `missing ${expectation.count - expectation.consumed} of ${expectation.count}: ${expectation.label}`,
        );
      const issues = [...failures, ...missing];
      if (issues.length > 0) throw new Error(issues.join('\n'));
    },
    stop() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('request', onRequest);
      page.off('requestfailed', onRequestFailed);
    },
  };
}

export function expectCancellableServerAction(
  monitor: BrowserErrorMonitor,
  page: Page,
  label: string,
  count = 1,
) {
  monitor.expectCancellableRequest({
    count,
    errorText: browserCancellationErrors,
    headers: { 'next-action': /.+/u },
    label,
    method: 'POST',
    url: page.url(),
  });
}

export function expectNextRscCancellation(
  monitor: BrowserErrorMonitor,
  url: string,
  label: string,
  count = 1,
) {
  monitor.expectRscCancellation({
    count,
    errorText: 'net::ERR_ABORTED',
    headers: { rsc: '1' },
    label,
    method: 'GET',
    url,
  });
}

export function expectCancellableNextRscRequest(
  monitor: BrowserErrorMonitor,
  url: string,
  label: string,
  count = 1,
) {
  monitor.expectCancellableRscRequest({
    count,
    errorText: 'net::ERR_ABORTED',
    headers: { rsc: '1' },
    label,
    method: 'GET',
    url,
  });
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
  let finish!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const requested = new Promise<void>((resolve) => (reached = resolve));
  const completed = new Promise<void>((resolve) => (finish = resolve));
  let matchingRequests = 0;
  let used = false;
  await page.route('**/*', async (route: Route) => {
    if (!matcher(route.request())) return route.fallback();
    matchingRequests += 1;
    if (used) return route.fallback();
    used = true;
    try {
      const response = await route.fetch();
      reached();
      await held;
      await route.fulfill({ response });
    } finally {
      finish();
    }
  });
  return {
    matchingRequestCount: () => matchingRequests,
    requested,
    release,
    async cleanup() {
      release();
      if (used) await completed;
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
