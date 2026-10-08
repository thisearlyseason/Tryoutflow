// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { Page, Request, Response } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { monitorOutgoingHomePrefetch } from '../../e2e/helpers/outgoing-prefetch';

const documentUrl = 'http://127.0.0.1:3112/register/synthetic';
const assetUrl = 'http://127.0.0.1:3112/_next/static/chunks/landing.exact.js';
const prefetchUrl = 'http://127.0.0.1:3112/?_rsc=exact-prefetch';
const declaredScript = `11:["$","script","script-0",{"src":"${new URL(assetUrl).pathname}","async":true}]`;

function request(input: {
  url: string;
  method?: string;
  resourceType?: string;
  headers?: Record<string, string>;
  response?: Response | null;
  failure?: string;
}): Request {
  return {
    url: () => input.url,
    method: () => input.method ?? 'GET',
    resourceType: () => input.resourceType ?? 'script',
    headers: () => input.headers ?? { referer: documentUrl },
    response: async () => input.response ?? null,
    failure: () => (input.failure ? { errorText: input.failure } : null),
  } as unknown as Request;
}

function response(input: {
  url: string;
  contentType: string;
  body?: string;
  ok?: boolean;
  bodyError?: Error;
}): Response {
  return {
    url: () => input.url,
    ok: () => input.ok ?? true,
    headers: () => ({ 'content-type': input.contentType }),
    body: vi.fn(async () => {
      if (input.bodyError) throw input.bodyError;
      return Buffer.from(input.body ?? 'window.landingLoaded = true;');
    }),
  } as unknown as Response;
}

function prefetch(body = declaredScript): Request {
  return request({
    url: prefetchUrl,
    resourceType: 'fetch',
    headers: { referer: documentUrl, rsc: '1', 'next-router-prefetch': '1' },
    response: response({ url: prefetchUrl, contentType: 'text/x-component', body }),
  });
}

class FakePage extends EventEmitter {
  readonly requests = vi.fn(async () => [] as Request[]);
  readonly waitForRequest = vi.fn<(predicate: (request: Request) => boolean) => Promise<Request>>(
    async () => {
      throw new Error('declared asset was never requested');
    },
  );
  url() {
    return documentUrl;
  }
}

describe('outgoing registration homepage prefetch completion', () => {
  it('does nothing when request-time rendering produces no homepage prefetch', async () => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    await waiter.waitForScripts();
    expect(page.waitForRequest).not.toHaveBeenCalled();
    waiter.stop();
    expect(page.listenerCount('request')).toBe(0);
  });

  it('waits for the complete exact browser-loaded script, including a previously captured response', async () => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    const script = response({
      url: assetUrl,
      contentType: 'application/javascript; charset=utf-8',
    });
    page.emit('request', prefetch());
    page.emit('request', request({ url: assetUrl, response: script }));
    await waiter.waitForScripts();
    expect(script.body).toHaveBeenCalledOnce();
    expect(page.waitForRequest).not.toHaveBeenCalled();
    waiter.stop();
  });

  it('waits for an asset requested after the received prefetch body declares it', async () => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    page.emit('request', prefetch());
    const script = request({
      url: assetUrl,
      response: response({ url: assetUrl, contentType: 'text/javascript' }),
    });
    page.waitForRequest.mockImplementation(async (predicate) => {
      expect(predicate(script)).toBe(true);
      expect(predicate(request({ url: assetUrl + '?wrong-version' }))).toBe(false);
      expect(predicate(request({ url: assetUrl, method: 'POST' }))).toBe(false);
      expect(predicate(request({ url: assetUrl, resourceType: 'fetch' }))).toBe(false);
      expect(
        predicate(request({ url: assetUrl, headers: { referer: 'http://127.0.0.1:3112/other' } })),
      ).toBe(false);
      return script;
    });
    await waiter.waitForScripts();
    expect(page.waitForRequest).toHaveBeenCalledOnce();
    waiter.stop();
  });

  it('does not wait for import references that do not declare script elements', async () => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    page.emit(
      'request',
      prefetch('3:I[522016,["/_next/static/chunks/unused-import.js"],"default"]'),
    );
    await waiter.waitForScripts();
    expect(page.waitForRequest).not.toHaveBeenCalled();
    waiter.stop();
  });

  it('completes a follow-up segment observed while the first prefetch body is consumed', async () => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    const initialResponse = response({ url: prefetchUrl, contentType: 'text/x-component' });
    const script = response({ url: assetUrl, contentType: 'application/javascript' });
    initialResponse.body = vi.fn(async () => {
      page.emit('request', prefetch());
      page.emit('request', request({ url: assetUrl, response: script }));
      return Buffer.from('0:{"data":[]}');
    });
    page.emit(
      'request',
      request({
        url: prefetchUrl,
        resourceType: 'fetch',
        headers: { referer: documentUrl, rsc: '1', 'next-router-prefetch': '1' },
        response: initialResponse,
      }),
    );
    await waiter.waitForScripts();
    expect(script.body).toHaveBeenCalledOnce();
    expect(page.requests).toHaveBeenCalledTimes(3);
    waiter.stop();
  });

  it.each([
    { name: 'missing response', result: null },
    {
      name: 'failed status',
      result: response({ url: assetUrl, contentType: 'application/javascript', ok: false }),
    },
    {
      name: 'redirected URL',
      result: response({ url: assetUrl + '?different', contentType: 'application/javascript' }),
    },
    { name: 'wrong MIME type', result: response({ url: assetUrl, contentType: 'text/html' }) },
    {
      name: 'incomplete body',
      result: response({
        url: assetUrl,
        contentType: 'application/javascript',
        bodyError: new Error('incomplete body'),
      }),
    },
  ])('keeps a real script failure fatal: $name', async ({ result }) => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    page.emit('request', prefetch());
    page.emit('request', request({ url: assetUrl, response: result }));
    await expect(waiter.waitForScripts()).rejects.toThrow();
    waiter.stop();
  });

  it('rejects a recorded request failure even if its response body is readable', async () => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    page.emit('request', prefetch());
    page.emit(
      'request',
      request({
        url: assetUrl,
        response: response({ url: assetUrl, contentType: 'application/javascript' }),
        failure: 'Load request cancelled',
      }),
    );
    await expect(waiter.waitForScripts()).rejects.toThrow(/completes/u);
    waiter.stop();
  });

  it('rejects a missing declared request without substituting a Node asset request', async () => {
    const page = new FakePage();
    const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
    page.emit('request', prefetch());
    await expect(waiter.waitForScripts()).rejects.toThrow(/never requested/u);
    expect(page.waitForRequest).toHaveBeenCalledOnce();
    waiter.stop();
  });

  it.each<Partial<Parameters<typeof request>[0]>>([
    { url: 'http://different.test/?_rsc=exact-prefetch' },
    { url: 'http://127.0.0.1:3112/other?_rsc=exact-prefetch' },
    { url: 'http://127.0.0.1:3112/?_rsc=' },
    { url: 'http://127.0.0.1:3112/?_rsc=one&_rsc=two' },
    { method: 'POST' },
    { headers: { referer: documentUrl, rsc: '1' } },
    { headers: { referer: documentUrl, 'next-router-prefetch': '1' } },
    { headers: { referer: 'http://127.0.0.1:3112/other', rsc: '1', 'next-router-prefetch': '1' } },
  ])(
    'ignores requests outside the exact outgoing homepage prefetch boundary: %j',
    async (change) => {
      const page = new FakePage();
      const waiter = monitorOutgoingHomePrefetch(page as unknown as Page);
      page.emit(
        'request',
        request({
          url: prefetchUrl,
          headers: { referer: documentUrl, rsc: '1', 'next-router-prefetch': '1' },
          ...change,
        }),
      );
      await waiter.waitForScripts();
      expect(page.waitForRequest).not.toHaveBeenCalled();
      waiter.stop();
    },
  );
});
