import type { Page, Request } from '@playwright/test';
import { expect } from '@playwright/test';

export function monitorOutgoingHomePrefetch(page: Page) {
  const requests: Request[] = [];
  const capture = (request: Request) => {
    if (!requests.includes(request)) requests.push(request);
  };
  page.on('request', capture);

  return {
    async waitForScripts() {
      const documentUrl = new URL(page.url());
      expect(documentUrl.pathname.startsWith('/register/')).toBe(true);
      const fromOutgoingDocument = (request: Request) =>
        request.headers()['referer'] === documentUrl.href;
      const isOutgoingPrefetch = (request: Request) => {
        const url = new URL(request.url());
        return (
          request.method() === 'GET' &&
          url.origin === documentUrl.origin &&
          url.pathname === '/' &&
          url.searchParams.getAll('_rsc').length === 1 &&
          Boolean(url.searchParams.get('_rsc')) &&
          request.headers()['rsc'] === '1' &&
          request.headers()['next-router-prefetch'] === '1' &&
          fromOutgoingDocument(request)
        );
      };
      const completedPrefetches = new Set<Request>();
      const completedAssets = new Set<string>();
      while (true) {
        // Refresh the observed request list after each completed prefetch batch.
        // Next can request a follow-up segment while consuming the first body.
        // Stop immediately when no unprocessed prefetch is observed; no quiet wait.
        for (const request of await page.requests()) capture(request);
        const prefetches = requests.filter(
          (request) => isOutgoingPrefetch(request) && !completedPrefetches.has(request),
        );
        if (prefetches.length === 0) return;
        const assets = new Set<string>();
        for (const request of prefetches) {
          const response = await request.response();
          expect(response, 'the outgoing home prefetch receives a response').not.toBeNull();
          expect(response!.url()).toBe(request.url());
          expect(response!.ok(), 'the outgoing home prefetch succeeds').toBe(true);
          expect(response!.headers()['content-type']).toContain('text/x-component');
          const body = (await response!.body()).toString();
          expect(request.failure(), 'the outgoing home prefetch completes').toBeNull();
          // Wait for actual script elements declared by the received prefetch tree,
          // not every import reference or unrelated background request.
          for (const match of body.matchAll(
            /"src"\s*:\s*"(\/_next\/static\/chunks\/[^"\\\s]+\.js(?:\?[^"\\\s]*)?)"/gu,
          ))
            assets.add(new URL(match[1]!, documentUrl).href);
          completedPrefetches.add(request);
        }
        for (const url of assets) {
          if (completedAssets.has(url)) continue;
          const matchesAsset = (request: Request) =>
            request.method() === 'GET' &&
            request.resourceType() === 'script' &&
            request.url() === url &&
            fromOutgoingDocument(request);
          const request = requests.find(matchesAsset) ?? (await page.waitForRequest(matchesAsset));
          const response = await request.response();
          expect(
            response,
            'the declared outgoing prefetch script receives a response',
          ).not.toBeNull();
          expect(response!.url()).toBe(url);
          expect(response!.ok(), 'the declared outgoing prefetch script succeeds').toBe(true);
          expect(response!.headers()['content-type']).toMatch(
            /^(?:application|text)\/(?:x-)?javascript(?:;|$)/iu,
          );
          await response!.body();
          expect(request.failure(), 'the declared outgoing prefetch script completes').toBeNull();
          completedAssets.add(url);
        }
      }
    },
    stop() {
      page.off('request', capture);
    },
  };
}
