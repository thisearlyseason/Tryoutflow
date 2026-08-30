import { NextResponse } from 'next/server';

import type { BillingProvider } from '../../../infrastructure/billing/billing-provider';
import type { OrganizationId } from '../../../lib/ids';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import type { StripePriceMapping } from '../domain/plans';
import type { OwnedAccountLoader } from './billing-session-shared';

export const BILLING_REQUEST_MAX_BYTES = 1_024;

export type BillingRouteDependencies = Readonly<{
  canonicalOrigin: string;
  provider: BillingProvider;
  prices: StripePriceMapping;
  authenticate(
    organizationId: OrganizationId,
  ): Promise<{ actor: AuthorizationContext; organizationSlug: string } | null>;
  loadOwnedAccount: OwnedAccountLoader;
}>;

export function billingJsonError(status: number, code: string) {
  return NextResponse.json({ error: code }, { status });
}

export async function readBillingJson(request: Request, canonicalOrigin: string): Promise<unknown> {
  if (request.method !== 'POST') throw { status: 405 };
  if (new URL(request.url).origin !== canonicalOrigin) throw { status: 403 };
  if (request.headers.get('origin') !== canonicalOrigin) throw { status: 403 };
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  )
    throw { status: 415 };
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const announced = Number(contentLength);
    if (!Number.isSafeInteger(announced) || announced < 0) throw { status: 400 };
    if (announced > BILLING_REQUEST_MAX_BYTES) throw { status: 413 };
  }
  if (!request.body) throw { status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > BILLING_REQUEST_MAX_BYTES) {
      await reader.cancel();
      throw { status: 413 };
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw { status: 400 };
  }
}

export function billingRouteFailure(error: unknown) {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : 503;
  if ([400, 403, 405, 413, 415].includes(status)) {
    const code =
      status === 403
        ? 'forbidden'
        : status === 405
          ? 'method_not_allowed'
          : status === 413
            ? 'request_too_large'
            : status === 415
              ? 'unsupported_media_type'
              : 'invalid_request';
    return billingJsonError(status, code);
  }
  return billingJsonError(503, 'billing_unavailable');
}

export function billingCommandFailure(code: string) {
  const status =
    code === 'forbidden'
      ? 403
      : code === 'invalid_plan' || code === 'invalid_return_url'
        ? 400
        : code === 'subscription_exists' || code === 'portal_unavailable'
          ? 409
          : 503;
  return billingJsonError(status, code);
}
