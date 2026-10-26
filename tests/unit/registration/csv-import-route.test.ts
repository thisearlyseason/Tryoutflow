// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: '10101010-1010-4010-8010-101010101010' } } }),
    },
    from: mockFrom,
  }),
}));
vi.mock('../../../src/modules/organizations/infrastructure/membership-repository', () => ({
  SupabaseMembershipRepository: class {
    async findAuthorizationContext() {
      return {
        userId: '10101010-1010-4010-8010-101010101010',
        organizationId: 'a0101010-1010-4010-8010-101010101010',
        organizationRole: 'administrator',
        membershipStatus: 'active',
        assignments: [],
      };
    }
  },
}));

let post: typeof import('../../../src/app/api/organizations/[organizationId]/athlete-imports/route').POST;
const context = {
  params: Promise.resolve({ organizationId: 'a0101010-1010-4010-8010-101010101010' }),
};

beforeAll(async () => {
  post = (await import('../../../src/app/api/organizations/[organizationId]/athlete-imports/route'))
    .POST;
});

describe('authenticated CSV import HTTP boundary', () => {
  it('loads only the current actor persisted preview for decision-to-commit recovery', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'preview-id',
        organization_id: 'a0101010-1010-4010-8010-101010101010',
        source_digest: 'a'.repeat(64),
        column_mapping: { givenName: 'First', familyName: 'Last', birthDate: 'DOB' },
        preview_rows: [],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    });
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: vi.fn(),
      eq: vi.fn((field: string, value: unknown) => {
        filters.push([field, value]);
        return query;
      }),
      gt: vi.fn(() => query),
      is: vi.fn(() => query),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    mockFrom.mockReturnValueOnce(query);
    const response = await post(
      new NextRequest(
        'http://localhost/api/organizations/a0101010-1010-4010-8010-101010101010/athlete-imports',
        {
          method: 'POST',
          headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'load_preview', previewId: 'preview-id' }),
        },
      ),
      context,
    );
    expect(response.status).toBe(200);
    expect(filters).toContainEqual(['actor_user_id', '10101010-1010-4010-8010-101010101010']);
    expect(filters).toContainEqual(['organization_id', 'a0101010-1010-4010-8010-101010101010']);
  });

  it('requires same-origin exact JSON requests', async () => {
    const response = await post(
      new NextRequest('http://localhost/api/organizations/a/athlete-imports', {
        method: 'POST',
        headers: { origin: 'https://attacker.example', 'content-type': 'text/plain' },
        body: '{}',
      }),
      context,
    );
    expect(response.status).toBe(415);
  });

  it('measures streamed bytes instead of trusting content-length', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(2_200_001));
    const response = await post(
      new NextRequest('http://localhost/api/organizations/a/athlete-imports', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          'content-type': 'application/json',
          'content-length': '10',
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        duplex: 'half',
      } as unknown as ConstructorParameters<typeof NextRequest>[1]),
      context,
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'request_too_large' });
  });

  it('rejects malformed UTF-8 CSV bytes instead of replacing them', async () => {
    const malformed = Buffer.from([0x46, 0x69, 0x72, 0x73, 0x74, 0x2c, 0xff]).toString('base64');
    const response = await post(
      new NextRequest(
        'http://localhost/api/organizations/a0101010-1010-4010-8010-101010101010/athlete-imports',
        {
          method: 'POST',
          headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'preview',
            contentBase64: malformed,
            mapping: { givenName: 'First', familyName: 'Last', birthDate: 'DOB' },
          }),
        },
      ),
      context,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
  });
});
