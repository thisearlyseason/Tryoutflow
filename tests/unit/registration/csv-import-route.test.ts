// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: '10101010-1010-4010-8010-101010101010' } } }),
    },
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
});
