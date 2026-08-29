import { createHmac } from 'node:crypto';

import type { NextRequest } from 'next/server';

import { getServerEnvironment } from '../../../../lib/env';

export const MAX_PUBLIC_REGISTRATION_BODY_BYTES = 32 * 1024;

type GuardFailure = { ok: false; status: 400 | 403 | 413 };
type ParsedTarget<T> = { body: T; target: string };

function trustedAddress(request: NextRequest) {
  const candidate =
    request.headers.get('x-vercel-forwarded-for') ??
    (process.env.NODE_ENV !== 'production' ? request.headers.get('x-forwarded-for') : null);
  const address = candidate?.split(',', 1)[0]?.trim();
  if (!address) {
    const localHost =
      request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1';
    return process.env.NODE_ENV !== 'production' && localHost
      ? `local-development:${request.nextUrl.hostname}`
      : null;
  }
  if (address.length > 200 || /[\r\n|]/u.test(address)) return null;
  return address;
}

async function readBodyWithinLimit(request: NextRequest) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > MAX_PUBLIC_REGISTRATION_BODY_BYTES) return null;
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

export async function guardPublicJsonRequest<T>(
  request: NextRequest,
  options: {
    bucket: 'registration' | 'confirmation' | 'reissue' | 'consume';
    parse(value: unknown): ParsedTarget<T> | null;
  },
): Promise<
  (ParsedTarget<T> & { ok: true; contextRateKey: string; rateKey: string }) | GuardFailure
> {
  const origin = request.headers.get('origin');
  const mime = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
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
  const expectedOrigin =
    host && /^[A-Za-z0-9.:[\]-]+$/u.test(host) ? `${protocol}://${host}` : request.nextUrl.origin;
  if (origin === null || origin !== expectedOrigin || mime !== 'application/json') {
    return { ok: false, status: 403 };
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PUBLIC_REGISTRATION_BODY_BYTES) {
      return { ok: false, status: 413 };
    }
  }
  const address = trustedAddress(request);
  if (!address) return { ok: false, status: 400 };

  try {
    const raw = await readBodyWithinLimit(request);
    if (raw === null) return { ok: false, status: 413 };
    const parsed = options.parse(JSON.parse(raw) as unknown);
    if (!parsed || parsed.target.length > 256 || /[\r\n|]/u.test(parsed.target)) {
      return { ok: false, status: 400 };
    }
    const secret = getServerEnvironment().PUBLIC_REGISTRATION_RATE_LIMIT_SECRET;
    const contextRateKey = createHmac('sha256', secret)
      .update(`${options.bucket}|context|${address}`)
      .digest('hex');
    const rateKey = createHmac('sha256', secret)
      .update(`${options.bucket}|target|${parsed.target}|${address}`)
      .digest('hex');
    return { ok: true, ...parsed, contextRateKey, rateKey };
  } catch {
    return { ok: false, status: 400 };
  }
}
