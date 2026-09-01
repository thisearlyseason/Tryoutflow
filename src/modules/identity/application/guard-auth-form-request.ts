import type { NextRequest } from 'next/server';

import { getTrustedRequestOrigin } from '../../../lib/request-origin';
import {
  getTrustedAuthRequestContext,
  type AuthRequestContext,
} from './database-auth-abuse-protection';

export const MAX_AUTH_FORM_BODY_BYTES = 8 * 1024;

async function readBoundedBody(request: NextRequest) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > MAX_AUTH_FORM_BODY_BYTES) return null;
    chunks.push(next.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(combined);
}

function exactTestAddress(request: NextRequest) {
  if (process.env.NODE_ENV === 'test' && process.env.TRYOUTFLOW_SERVER_TEST_ENV === 'vitest')
    return request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim();
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.TRYOUTFLOW_SERVER_TEST_ENV === 'task30-playwright' &&
    process.env.TRYOUTFLOW_BOT_PROTECTION_MODE === 'deterministic-test' &&
    ['127.0.0.1', 'localhost'].includes(request.nextUrl.hostname)
  )
    return 'task30-local-browser';
  if (
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname)
  )
    return `local-development:${request.nextUrl.hostname}`;
  return undefined;
}

export async function guardAuthFormRequest(
  request: NextRequest,
  options: { allowedFields: readonly string[] },
): Promise<
  | { ok: true; fields: URLSearchParams; requestContext: AuthRequestContext }
  | { ok: false; status: 400 | 403 | 413 }
> {
  const mime = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    request.headers.get('origin') !== getTrustedRequestOrigin(request) ||
    mime !== 'application/x-www-form-urlencoded'
  )
    return { ok: false, status: 403 };
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_AUTH_FORM_BODY_BYTES)
      return { ok: false, status: 413 };
  }
  try {
    const body = await readBoundedBody(request);
    if (body === null) return { ok: false, status: 413 };
    const fields = new URLSearchParams(body);
    const allowed = new Set(options.allowedFields);
    const names = [...fields.keys()];
    if (
      names.some((name) => !allowed.has(name)) ||
      new Set(names).size !== names.length ||
      names.length > allowed.size
    )
      return { ok: false, status: 400 };
    const trusted = getTrustedAuthRequestContext(request.headers).networkAddress;
    const networkAddress = trusted ?? exactTestAddress(request);
    if (!networkAddress || networkAddress.length > 128 || /[\r\n|]/u.test(networkAddress))
      return { ok: false, status: 400 };
    return { ok: true, fields, requestContext: { networkAddress } };
  } catch {
    return { ok: false, status: 400 };
  }
}
