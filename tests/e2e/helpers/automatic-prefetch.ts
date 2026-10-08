import type { Page, Request } from '@playwright/test';
import { expect } from '@playwright/test';

export function monitorAutomaticPrefetch(page: Page) {
  const requests: string[] = [];
  const capture = (request: Request) => {
    const headers = request.headers();
    if (
      request.method() === 'GET' &&
      new URL(request.url()).origin === new URL(page.url()).origin &&
      headers.rsc === '1' &&
      (headers['next-router-prefetch'] !== undefined ||
        headers['next-router-segment-prefetch'] !== undefined)
    ) {
      requests.push(request.url());
    }
  };
  page.on('request', capture);
  return {
    assertNone() {
      expect(requests, 'public links do not start automatic RSC prefetches').toEqual([]);
    },
    stop() {
      page.off('request', capture);
    },
  };
}
