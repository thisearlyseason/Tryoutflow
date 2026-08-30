import { createHmac } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import type { NextRequest } from 'next/server';

import { getServerEnvironment } from '../../../../lib/env';

export const MAX_PUBLIC_REGISTRATION_BODY_BYTES = 32 * 1024;

export function recordIntegrationRateKeys(keys: string[]) {
  if (process.env.NODE_ENV !== 'test') return;
  const runId = process.env.TRYOUTFLOW_INTEGRATION_RUN_ID;
  const path = process.env.TRYOUTFLOW_INTEGRATION_RATE_KEY_LOG;
  if (!runId && !path) return;
  if (
    !runId ||
    !/^[0-9a-f]{16}$/u.test(runId) ||
    !path ||
    basename(path) !== `${runId}.rate-keys`
  ) {
    throw new Error('invalid integration rate-key ownership log');
  }
  const directory = lstatSync(dirname(path));
  const uid = typeof process.getuid === 'function' ? process.getuid() : directory.uid;
  if (
    directory.isSymbolicLink() ||
    !directory.isDirectory() ||
    directory.uid !== uid ||
    (directory.mode & 0o077) !== 0
  ) {
    throw new Error('unsafe integration rate-key ownership directory');
  }
  if (existsSync(path)) {
    const file = lstatSync(path);
    if (file.isSymbolicLink() || !file.isFile() || file.uid !== uid || (file.mode & 0o077) !== 0) {
      throw new Error('unsafe integration rate-key ownership log');
    }
  }
  appendFileSync(path, `${keys.join('\n')}\n`, { mode: 0o600 });
}

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
    recordIntegrationRateKeys([contextRateKey, rateKey]);
    return { ok: true, ...parsed, contextRateKey, rateKey };
  } catch {
    return { ok: false, status: 400 };
  }
}
