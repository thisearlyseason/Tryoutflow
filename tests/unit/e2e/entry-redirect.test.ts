// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Page, Request, Response } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { observeAppEntryRedirect, resolveAppEntryChunk } from '../../e2e/helpers/entry-redirect';
import { monitorBrowserErrors } from '../../e2e/helpers/network';

const origin = 'http://127.0.0.1:3112';
const chunk = '/_next/static/chunks/chooser-abc.js';
const metadata = [
  {
    route: '/app',
    firstLoadChunkPaths: ['.next/static/chunks/shared.js', '.next/static/chunks/chooser-abc.js'],
  },
  { route: '/app/[organizationSlug]/home', firstLoadChunkPaths: ['.next/static/chunks/shared.js'] },
];
class EntryPage extends EventEmitter {
  current = `${origin}/sign-in`;
  frame = {};
  url() {
    return this.current;
  }
  mainFrame() {
    return this.frame;
  }
}
function setup() {
  const page = new EntryPage();
  const monitor = monitorBrowserErrors(page as unknown as Page);
  const observer = observeAppEntryRedirect(page as unknown as Page, monitor, 'club', metadata);
  const request = (
    path: string,
    type = 'script',
    headers = { referer: `${origin}/app`, 'sec-fetch-dest': 'script' },
  ) =>
    ({
      method: () => 'GET',
      url: () => new URL(path, origin).href,
      resourceType: () => type,
      headers: () => headers,
      frame: () => page.frame,
      isNavigationRequest: () => type === 'document',
      failure: () => ({ errorText: 'NS_BINDING_ABORTED' }),
    }) as unknown as Request;
  const response = (req: Request, status = 200, body = '') =>
    ({
      request: () => req,
      status: () => status,
      url: () => req.url(),
      text: async () => body,
    }) as unknown as Response;
  const entry = request('/app', 'document');
  const html = `<script src="${chunk}"></script><meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/app/club/home"/>`;
  const enter = (body = html) => page.emit('response', response(entry, 200, body));
  const home = () => {
    page.current = `${origin}/app/club/home`;
    page.emit('response', response(request('/app/club/home', 'document')));
  };
  return { page, monitor, observer, request, response, enter, home };
}
describe('Firefox streamed app-entry redirect', () => {
  it('resolves only the unique entry chunk absent from home', () => {
    expect(resolveAppEntryChunk(metadata)).toBe(chunk);
    expect(() => resolveAppEntryChunk([])).toThrow();
    expect(() =>
      resolveAppEntryChunk([...metadata, { route: '/app', firstLoadChunkPaths: [] }]),
    ).toThrow();
    expect(() =>
      resolveAppEntryChunk([
        {
          route: '/app',
          firstLoadChunkPaths: ['.next/static/chunks/a.js', '.next/static/chunks/b.js'],
        },
        metadata[1],
      ]),
    ).toThrow(/Ambiguous/u);
    expect(() =>
      resolveAppEntryChunk([
        { route: '/app', firstLoadChunkPaths: ['https://other.example/chooser.js'] },
        metadata[1],
      ]),
    ).toThrow(/Ambiguous/u);
  });
  it('allows exactly the served script discarded by a proven streamed redirect', async () => {
    const s = setup();
    s.enter();
    const req = s.request(chunk);
    s.page.emit('response', s.response(req));
    s.home();
    s.page.emit('requestfailed', req);
    await s.observer.assertAndStop();
    expect(() => s.monitor.assertClean()).not.toThrow();
    expect(s.page.listenerCount('response')).toBe(0);
  });
  it.each([
    'non200',
    'wrong-referrer',
    'wrong-route',
    'wrong-frame',
    'wrong-destination',
    'wrong-origin',
    'wrong-method',
    'wrong-resource',
    'no-entry',
  ])('does not allow %s', async (kind) => {
    const s = setup();
    if (kind !== 'no-entry') s.enter();
    const req = s.request(
      kind === 'wrong-route'
        ? '/_next/static/chunks/other.js'
        : kind === 'wrong-origin'
          ? `https://other.example${chunk}`
          : chunk,
      kind === 'wrong-resource' ? 'fetch' : 'script',
      {
        referer: `${origin}/${kind === 'wrong-referrer' ? 'other' : 'app'}`,
        'sec-fetch-dest': kind === 'wrong-destination' ? 'image' : 'script',
      },
    );
    if (kind === 'wrong-frame') Object.assign(req, { frame: () => ({}) });
    if (kind === 'wrong-method') Object.assign(req, { method: () => 'POST' });
    s.page.emit('response', s.response(req, kind === 'non200' ? 503 : 200));
    s.home();
    s.page.emit('requestfailed', req);
    await s.observer.assertAndStop();
    expect(() => s.monitor.assertClean()).toThrow(/unexpected request failure/u);
  });
  it.each(['missing-redirect', 'missing-declared-asset', 'no-home-response', 'wrong-final-route'])(
    'rejects a cancellation with %s',
    async (kind) => {
      const s = setup();
      s.enter(
        kind === 'missing-redirect'
          ? `<script src="${chunk}"></script>`
          : kind === 'missing-declared-asset'
            ? '<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/app/club/home"/>'
            : undefined,
      );
      const req = s.request(chunk);
      s.page.emit('response', s.response(req));
      if (kind !== 'no-home-response') s.home();
      if (kind === 'wrong-final-route') s.page.current = `${origin}/app/other/home`;
      s.page.emit('requestfailed', req);
      await expect(s.observer.assertAndStop()).rejects.toThrow(/redirect/u);
    },
  );
  it('does not allow a second request or a duplicate failure for the same asset', async () => {
    for (const sameRequest of [false, true]) {
      const s = setup();
      s.enter();
      const first = s.request(chunk);
      s.page.emit('response', s.response(first));
      s.home();
      s.page.emit('requestfailed', first);
      const second = sameRequest ? first : s.request(chunk);
      s.page.emit('response', s.response(second));
      s.page.emit('requestfailed', second);
      await s.observer.assertAndStop();
      expect(() => s.monitor.assertClean()).toThrow(/unexpected request failure/u);
    }
  });
  it('detaches without changing monitor defaults when no script is canceled', async () => {
    const s = setup();
    await s.observer.assertAndStop();
    const req = s.request(chunk);
    s.page.emit('response', s.response(req));
    s.page.emit('requestfailed', req);
    expect(() => s.monitor.assertClean()).toThrow(/unexpected request failure/u);
  });
  it.each(['assertAndStop', 'stop'] as const)(
    'revokes a captured allowance after %s',
    async (method) => {
      const s = setup();
      s.enter();
      const req = s.request(chunk);
      s.page.emit('response', s.response(req));
      await s.observer[method]();
      s.page.emit('requestfailed', req);
      expect(() => s.monitor.assertClean()).toThrow(/unexpected request failure/u);
    },
  );
});
