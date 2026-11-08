import { readFileSync } from 'node:fs';

import type { Page, Request, Response } from '@playwright/test';

import type { BrowserErrorMonitor } from './network';

type BundleRoute = { route: string; firstLoadChunkPaths: string[] };

/** Fail closed if a build no longer has one identifiable app-entry-only chunk. */
export function resolveAppEntryChunk(metadata: unknown): string {
  if (!Array.isArray(metadata)) throw new Error('Missing app-entry bundle metadata');
  const routes = metadata as BundleRoute[];
  const entry = routes.filter((row) => row.route === '/app');
  const home = routes.filter((row) => row.route === '/app/[organizationSlug]/home');
  const appRoute = entry[0];
  const homeRoute = home[0];
  if (entry.length !== 1 || home.length !== 1 || !appRoute || !homeRoute)
    throw new Error('Ambiguous app-entry bundle routes');
  const chunks = appRoute.firstLoadChunkPaths.filter(
    (path) => !homeRoute.firstLoadChunkPaths.includes(path),
  );
  const chunk = chunks[0];
  if (chunks.length !== 1 || !chunk || !/^\.next\/static\/chunks\/[a-z0-9_-]+\.js$/u.test(chunk))
    throw new Error('Ambiguous app-entry-only JavaScript chunk');
  return chunk.replace(/^\.next\//u, '/_next/');
}

/** Firefox may discard an unused chooser chunk during Next's streamed /app redirect. */
export function observeAppEntryRedirect(
  page: Page,
  monitor: BrowserErrorMonitor,
  organizationSlug?: string,
  metadata: unknown = JSON.parse(readFileSync('.next/diagnostics/route-bundle-stats.json', 'utf8')),
) {
  const origin = new URL(page.url()).origin;
  const entryUrl = `${origin}/app`;
  const chunkPath = resolveAppEntryChunk(metadata);
  const chunkUrl = `${origin}${chunkPath}`;
  const isDestination = (url: string) => {
    const value = new URL(url);
    if (value.origin !== origin || value.search || value.hash) return false;
    return organizationSlug
      ? value.pathname === `/app/${organizationSlug}/home`
      : value.pathname === '/participant' || /^\/app\/[^/]+\/home$/u.test(value.pathname);
  };
  let entry: Response | undefined;
  let captured: Request | undefined;
  let revokeAllowance: (() => void) | undefined;
  let canceled = false;
  const destinations = new Set<string>();
  const response = (value: Response) => {
    const request = value.request();
    if (
      request.method() !== 'GET' ||
      request.frame() !== page.mainFrame() ||
      value.status() !== 200
    )
      return;
    if (request.isNavigationRequest() && request.resourceType() === 'document') {
      if (value.url() === entryUrl) entry = value;
      else if (entry && isDestination(value.url())) destinations.add(value.url());
      return;
    }
    const headers = request.headers();
    if (
      captured ||
      !entry ||
      value.url() !== chunkUrl ||
      request.url() !== chunkUrl ||
      request.resourceType() !== 'script' ||
      headers.referer !== entryUrl ||
      headers['sec-fetch-dest'] !== 'script'
    )
      return;
    captured = request;
    revokeAllowance = monitor.allowOptionalRequestFailure({
      request,
      method: 'GET',
      url: chunkUrl,
      headers: { referer: entryUrl, 'sec-fetch-dest': 'script' },
      errorText: 'NS_BINDING_ABORTED',
      maxCount: 1,
      label: 'one verified Firefox streamed app-entry chooser cancellation',
    });
  };
  const failed = (request: Request) => {
    if (request === captured) canceled = true;
  };
  const stop = () => {
    revokeAllowance?.();
    revokeAllowance = undefined;
    page.off('response', response);
    page.off('requestfailed', failed);
  };
  page.on('response', response);
  page.on('requestfailed', failed);
  return {
    stop,
    async assertAndStop() {
      try {
        if (!canceled) return;
        const destination = page.url();
        if (!entry || !isDestination(destination) || !destinations.has(destination))
          throw new Error('Canceled app-entry chunk requires a completed known redirect');
        const html = await entry.text();
        const redirect = (html.match(/<meta\b[^>]*>/gu) ?? []).some(
          (tag) =>
            tag.includes('id="__next-page-redirect"') &&
            tag.includes('http-equiv="refresh"') &&
            tag.includes(`content="1;url=${new URL(destination).pathname}"`),
        );
        if (!redirect || !html.includes(`src="${chunkPath}"`))
          throw new Error(
            'Canceled app-entry chunk requires the declared asset and streamed redirect',
          );
      } finally {
        stop();
      }
    },
  };
}
