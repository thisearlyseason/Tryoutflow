import type { NextRequest } from 'next/server';

import { isBrowserTestBackend } from './browser-test-backend';

import { getPublicAppOrigin } from './env';

function requestHeaderOrigin(request: NextRequest): string {
  const host = request.headers.get('host');
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',', 1)[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : request.nextUrl.protocol.slice(0, -1);
  return host && /^[A-Za-z0-9.:[\]-]+$/u.test(host)
    ? `${protocol}://${host}`
    : request.nextUrl.origin;
}

function isExactLocalProductionBrowserBoundary(
  request: NextRequest,
  environment: Record<string, string | undefined>,
): boolean {
  if (
    environment.NODE_ENV !== 'production' ||
    environment.TRYOUTFLOW_SERVER_TEST_ENV !== 'task30-playwright' ||
    environment.TRYOUTFLOW_BOT_PROTECTION_MODE !== 'deterministic-test' ||
    environment.NEXT_PUBLIC_APP_URL !== 'https://task30.e2e.example.test' ||
    !isBrowserTestBackend(environment)
  )
    return false;
  try {
    const browserOrigin = new URL(requestHeaderOrigin(request));
    const configuredLocalOrigin = environment.TASK30_LOCAL_REQUEST_ORIGIN;
    if (configuredLocalOrigin) {
      const configured = new URL(configuredLocalOrigin);
      if (
        configured.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(configured.hostname) ||
        configured.port.length === 0 ||
        configured.username.length > 0 ||
        configured.password.length > 0 ||
        configured.pathname !== '/' ||
        configured.search.length > 0 ||
        configured.hash.length > 0
      )
        return false;
      return browserOrigin.origin === configured.origin;
    }
    return (
      browserOrigin.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(browserOrigin.hostname) &&
      browserOrigin.port === '3112'
    );
  } catch {
    return false;
  }
}

function vercelPreviewOrigin(environment: Record<string, string | undefined>): string | undefined {
  // Only this project's provider-injected deployment identity may override the public origin.
  // Never derive a hosted redirect origin from Host or forwarded headers.
  if (
    environment.VERCEL !== '1' ||
    environment.VERCEL_ENV !== 'preview' ||
    environment.VERCEL_PROJECT_ID !== 'prj_3oAxXhX98AXJ2mEWYi56n5iZneWI'
  )
    return undefined;
  if (
    environment.NEXT_PUBLIC_APP_URL === 'https://tryout-ux-qa-tylers-projects-5b59182e.vercel.app'
  )
    return environment.NEXT_PUBLIC_APP_URL;
  const hostname = environment.VERCEL_URL;
  if (!hostname || !/^tryout-[a-z0-9](?:[a-z0-9-]{0,54}[a-z0-9])?\.vercel\.app$/u.test(hostname))
    return undefined;
  return `https://${hostname}`;
}

/** Reconstructs the browser-visible same origin from deployment-controlled request metadata. */
export function getTrustedRequestOrigin(
  request: NextRequest,
  environment: Record<string, string | undefined> = process.env,
): string {
  if (isExactLocalProductionBrowserBoundary(request, environment))
    return requestHeaderOrigin(request);
  if (environment.NODE_ENV !== 'production') return requestHeaderOrigin(request);
  try {
    const canonicalOrigin = getPublicAppOrigin(environment);
    return vercelPreviewOrigin(environment) ?? canonicalOrigin;
  } catch {
    throw new Error('Production canonical origin is invalid');
  }
}

export function trustedRequestUrl(request: NextRequest, path: string): URL {
  return new URL(path, getTrustedRequestOrigin(request));
}
