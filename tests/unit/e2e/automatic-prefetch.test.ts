// @vitest-environment node

import { EventEmitter } from 'node:events';
import type { Page, Request } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { monitorAutomaticPrefetch } from '../../e2e/helpers/automatic-prefetch';

class FakePage extends EventEmitter {
  url() {
    return 'http://127.0.0.1:3112/register/synthetic';
  }
}

function request(headers: Record<string, string>, url = 'http://127.0.0.1:3112/?_rsc=synthetic') {
  return { headers: () => headers, method: () => 'GET', url: () => url } as Request;
}

describe('public automatic prefetch behavior', () => {
  it('allows real document, clicked RSC navigation, and JavaScript requests', () => {
    const page = new FakePage();
    const monitor = monitorAutomaticPrefetch(page as unknown as Page);
    page.emit('request', request({}));
    page.emit('request', request({ rsc: '1' }));
    page.emit('request', request({}, 'http://127.0.0.1:3112/_next/static/chunks/app.js'));
    monitor.assertNone();
    monitor.stop();
    expect(page.listenerCount('request')).toBe(0);
  });

  it.each(['1', '2', '3'])('rejects an automatic prefetch even if it succeeds: %s', (prefetch) => {
    const page = new FakePage();
    const monitor = monitorAutomaticPrefetch(page as unknown as Page);
    page.emit('request', request({ rsc: '1', 'next-router-prefetch': prefetch }));
    expect(() => monitor.assertNone()).toThrow(/do not start automatic RSC prefetches/u);
    monitor.stop();
  });

  it('rejects a segment prefetch without requiring a full-page prefetch header', () => {
    const page = new FakePage();
    const monitor = monitorAutomaticPrefetch(page as unknown as Page);
    page.emit('request', request({ rsc: '1', 'next-router-segment-prefetch': '/_tree' }));
    expect(() => monitor.assertNone()).toThrow(/do not start automatic RSC prefetches/u);
    monitor.stop();
  });
});
