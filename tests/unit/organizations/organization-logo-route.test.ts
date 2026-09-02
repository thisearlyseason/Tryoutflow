// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  captureOperationalError: vi.fn(),
  createHash: vi.fn(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  mocks.createHash.mockImplementation(actual.createHash);
  return { ...actual, createHash: mocks.createHash };
});
vi.mock('server-only', () => ({}));
vi.mock('../../../src/infrastructure/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.captureOperationalError,
}));

import { GET } from '../../../src/app/api/organizations/[organizationSlug]/logo/route';

const digest = '3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452';
const webpHex = '524946460400000057454250';
const validRow = {
  content: `\\x${webpHex}`,
  content_type: 'image/webp',
  byte_length: 12,
  sha256: digest,
  updated_at: '2026-09-01T17:00:00.000Z',
};

function request(headers?: HeadersInit) {
  return new NextRequest('https://tryoutflow.example/api/organizations/badlands/logo', {
    headers,
  });
}

const context = {
  params: Promise.resolve({ organizationSlug: 'badlands' }),
} as RouteContext<'/api/organizations/[organizationSlug]/logo'>;

describe('organization logo delivery route', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.captureOperationalError.mockReset();
    mocks.createHash.mockClear();
  });

  it('returns the exact normalized bytes with strong validation and revalidation headers', async () => {
    mocks.rpc.mockResolvedValue({ data: [validRow], error: null });

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString('hex')).toBe(webpHex);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('content-length')).toBe('12');
    expect(response.headers.get('etag')).toBe(`"${digest}"`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('content-disposition')).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith('read_organization_logo_service', {
      p_organization_slug: 'badlands',
    });
  });

  it('returns a bodyless 304 only for the matching quoted strong ETag', async () => {
    mocks.rpc.mockResolvedValue({ data: [validRow], error: null });

    const response = await GET(request({ 'if-none-match': `"${digest}"` }), context);

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('etag')).toBe(`"${digest}"`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('content-disposition')).toBe(false);
  });

  it.each([
    ['the wildcard', '*'],
    ['a weak validator', `W/"${digest}"`],
    ['a validator list containing a weak match', `"other", W/"${digest}"`],
    ['a list with a comma inside an opaque tag', `"opaque,tag", W/"${digest}"`],
    ['a matching validator after a leading empty member', `, "${digest}"`],
    ['a matching validator after an interior empty member', `"other",, W/"${digest}"`],
    ['a matching validator before a trailing empty member', `"${digest}",`],
    [
      'a matching validator surrounded by a bounded number of empty members',
      `${', '.repeat(32)}W/"${digest}"${', '.repeat(32)}`,
    ],
  ])('returns 304 when If-None-Match contains %s', async (_label, ifNoneMatch) => {
    mocks.rpc.mockResolvedValue({ data: [validRow], error: null });

    const response = await GET(request({ 'if-none-match': ifNoneMatch }), context);

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('etag')).toBe(`"${digest}"`);
  });

  it.each([
    ['a nonmatching validator', '"other"'],
    ['an unquoted value', digest],
    ['a malformed member after a match', `"${digest}", nope`],
    ['a wildcard mixed into a list', `*, "${digest}"`],
    ['too many empty list members', `${','.repeat(65)}W/"${digest}"`],
  ])('returns the representation for %s', async (_label, ifNoneMatch) => {
    mocks.rpc.mockResolvedValue({ data: [validRow], error: null });

    const response = await GET(request({ 'if-none-match': ifNoneMatch }), context);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString('hex')).toBe(webpHex);
  });

  it('returns a generic non-oracular 404 for an absent logo or invalid slug', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const missing = await GET(request(), context);
    const invalid = await GET(request(), {
      params: Promise.resolve({ organizationSlug: 'Badlands/private' }),
    } as RouteContext<'/api/organizations/[organizationSlug]/logo'>);

    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('Logo unavailable.');
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(invalid.status).toBe(404);
    expect(await invalid.text()).toBe('Logo unavailable.');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['duplicate rows', [validRow, validRow]],
    ['the wrong content type', [{ ...validRow, content_type: 'image/png' }]],
    ['an inconsistent byte length', [{ ...validRow, byte_length: 11 }]],
    ['a malformed digest', [{ ...validRow, sha256: 'private-digest' }]],
    ['malformed bytea', [{ ...validRow, content: 'guardian@example.test' }]],
  ])('returns generic unavailable for %s without leaking upstream data', async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    const response = await GET(request(), context);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('Logo temporarily unavailable.');
    expect(body).not.toMatch(/guardian|private|digest|bytea|database/iu);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('content-disposition')).toBe(false);
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'bytea text beyond the maximum normalized logo size',
      { ...validRow, content: `\\x${'00'.repeat(350_001)}`, byte_length: 350_000 },
    ],
    ['bytea text inconsistent with the declared byte length', { ...validRow, byte_length: 13 }],
  ])('rejects %s before decoding or hashing', async (_label, row) => {
    mocks.rpc.mockResolvedValue({ data: [row], error: null });
    const bufferFrom = vi.spyOn(Buffer, 'from');

    const response = await GET(request(), context);
    const decodeCalls = bufferFrom.mock.calls.length;
    const hashCalls = mocks.createHash.mock.calls.length;
    bufferFrom.mockRestore();

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Logo temporarily unavailable.');
    expect(decodeCalls).toBe(0);
    expect(hashCalls).toBe(0);
  });

  it('does not expose service errors in the unavailable response', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('organization=private-tenant bytes=secret-logo'),
    });

    const response = await GET(request(), context);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('Logo temporarily unavailable.');
    expect(body).not.toMatch(/private-tenant|secret-logo|organization|bytes/iu);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'organization.logo.read',
    });
  });
});
