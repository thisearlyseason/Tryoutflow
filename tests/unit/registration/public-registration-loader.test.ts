// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../src/lib/env', () => ({
  getServerEnvironment: () => ({
    PUBLIC_REGISTRATION_RATE_LIMIT_SECRET: 'unit-registration-secret'.padEnd(64, 'x'),
  }),
  getPublicAppOrigin: () => 'https://tryoutflow.example',
}));
vi.mock('../../../src/modules/identity/application/database-auth-abuse-protection', () => ({
  getDefaultAuthAbuseProtection: () => ({ check: async () => ({ allowed: true }) }),
}));
vi.mock('../../../src/infrastructure/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.captureOperationalError,
}));

import { GET, POST } from '../../../src/app/api/public/registrations/route';

function request(slug = 'fall-camp') {
  return new NextRequest(`https://tryoutflow.example/api/public/registrations?tryoutSlug=${slug}`);
}

const validConfiguration = {
  tryout_id: '11111111-1111-4111-8111-111111111111',
  name: 'Fall Camp',
  slug: 'fall-camp',
  form_version_id: '22222222-2222-4222-8222-222222222222',
  form_schema: { fields: [] },
  divisions: [],
  positions: [],
  organization_name: 'Badlands Hockey Academy',
  organization_slug: 'badlands-hockey-academy',
  logo_exists: true,
};

describe('public registration configuration loader outcomes', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.captureOperationalError.mockReset();
  });

  it('returns only safe branding for the exact published tryout organization', async () => {
    mocks.rpc.mockResolvedValue({ data: [validConfiguration], error: null });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      organization: {
        name: 'Badlands Hockey Academy',
        logoUrl: '/api/organizations/badlands-hockey-academy/logo',
      },
      tryout: {
        name: 'Fall Camp',
        slug: 'fall-camp',
        formVersionId: '22222222-2222-4222-8222-222222222222',
        formSchema: { fields: [] },
        divisions: [],
        positions: [],
      },
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('public_registration_tryout_v3', {
      p_tryout_slug: 'fall-camp',
    });
  });

  it('omits the logo URL when the exact published organization has no logo', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...validConfiguration, logo_exists: false }],
      error: null,
    });

    const response = await GET(request());
    const body = (await response.json()) as { organization: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      organization: { name: 'Badlands Hockey Academy' },
    });
    expect(body.organization).not.toHaveProperty('logoUrl');
  });

  it('keeps an actually absent or closed tryout non-oracular', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await GET(request('missing-camp'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      outcome: 'not_found',
      message: 'This registration is unavailable or closed.',
    });
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it('returns retryable unavailable without leaking an infrastructure error as a false 404', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('database unavailable for guardian@example.test token=provider-secret'),
    });

    const response = await GET(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toBe(
      JSON.stringify({
        outcome: 'unavailable',
        message: 'Registration is temporarily unavailable. Please retry.',
      }),
    );
    expect(serialized).not.toMatch(/guardian|provider-secret|database/iu);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'registration.load',
    });
  });

  it('treats malformed upstream configuration as unavailable rather than absent', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          name: 'Fall Camp',
          slug: 'fall-camp',
          form_schema: { fields: 'malformed' },
          divisions: [],
          positions: [],
        },
      ],
      error: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      outcome: 'unavailable',
      message: 'Registration is temporarily unavailable. Please retry.',
    });
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a null outer result', null],
    ['a non-array outer result', validConfiguration],
    ['multiple rows for a unique slug', [validConfiguration, validConfiguration]],
  ])(
    'treats %s as unavailable rather than a false 404 or ambiguous success',
    async (_label, data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });

      const response = await GET(request());

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        outcome: 'unavailable',
        message: 'Registration is temporarily unavailable. Please retry.',
      });
      expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
    },
  );
});

it.each(['scheduled', 'closed'] as const)(
  'returns the actual %s registration window instead of a false404',
  async (outcome) => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({
      data: [
        {
          outcome,
          name: 'U15',
          organization_name: 'Badlands',
          timezone: 'America/Edmonton',
          registration_starts_at: '2026-09-17T18:51:00+00:00',
          registration_ends_at: '2026-09-19T18:51:00+00:00',
        },
      ],
      error: null,
    });
    const response = await GET(request('u15'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome,
      registrationWindow: {
        name: 'U15',
        timezone: 'America/Edmonton',
        opensAt: '2026-09-17T18:51:00+00:00',
        closesAt: '2026-09-19T18:51:00+00:00',
      },
    });
  },
);

it('keeps a schedule lookup failure retryable', async () => {
  mocks.rpc.mockReset();
  mocks.rpc
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '08006' } });
  const response = await GET(request('u15'));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ outcome: 'unavailable' });
});

describe('public registration form version binding', () => {
  const oldVersion = '33333333-3333-4333-8333-333333333333';
  function submitRequest(formVersionId: unknown = oldVersion) {
    return new NextRequest('https://tryoutflow.example/api/public/registrations', {
      method: 'POST',
      headers: {
        origin: 'https://tryoutflow.example',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({
        tryoutSlug: 'fall-camp',
        idempotencyKey: 'registration-version-test-00001',
        botVerificationToken: 'test-token',
        formVersionId,
        submission: {
          givenName: 'Ava',
          familyName: 'Smith',
          birthDate: '2013-05-01',
          guardianName: 'Taylor Smith',
          guardianEmail: 'guardian@example.com',
          responses: {},
        },
      }),
    });
  }
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it('rejects a missing version with a reload response before creating a registration', async () => {
    const request = submitRequest();
    const body = await request.json();
    delete body.formVersionId;
    const response = await POST(
      new NextRequest(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      outcome: 'form_changed',
      message: expect.stringMatching(/reload.*review/iu),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects an invalid version identifier', async () => {
    const response = await POST(submitRequest('invalid-id'));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: 'form_changed', addedRequiredField: false },
    { outcome: 'replayed', addedRequiredField: false },
    { outcome: 'form_changed', addedRequiredField: true },
    { outcome: 'replayed', addedRequiredField: true },
  ] as const)(
    'honors atomic $outcome for a previously loaded version with added required field $addedRequiredField',
    async ({ outcome, addedRequiredField }) => {
      mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
        if (name === 'consume_public_registration_rate_limit')
          return { data: [{ outcome: 'allowed' }], error: null };
        if (name === 'public_registration_tryout_v3')
          return {
            data: [
              {
                ...validConfiguration,
                form_schema: addedRequiredField
                  ? {
                      fields: [
                        {
                          key: 'new_terms',
                          label: 'New terms',
                          kind: 'consent',
                          required: true,
                          sortOrder: 0,
                        },
                      ],
                    }
                  : validConfiguration.form_schema,
              },
            ],
            error: null,
          };
        if (
          name === 'submit_public_registration_with_notification_v2' &&
          args.p_expected_form_version_id === oldVersion
        )
          return {
            data: [
              {
                outcome,
                registration_id: '44444444-4444-4444-8444-444444444444',
                confirmation_token: 'a'.repeat(64),
              },
            ],
            error: null,
          };
        if (name === 'queue_registration_confirmation_communication_v2')
          return { data: [{ outcome: 'queued' }], error: null };
        return { data: null, error: new Error('Unexpected RPC contract') };
      });
      const response = await POST(submitRequest());
      expect(response.status).toBe(outcome === 'form_changed' ? 409 : 200);
      expect(await response.json()).toMatchObject(
        outcome === 'form_changed'
          ? { outcome: 'form_changed', message: expect.stringMatching(/reload.*review/iu) }
          : { ok: true, delivery: 'queued' },
      );
    },
  );

  it.each([undefined, 'invalid-id'])(
    'does not expose a configuration with invalid form version %s',
    async (form_version_id) => {
      mocks.rpc.mockResolvedValue({
        data: [{ ...validConfiguration, form_version_id }],
        error: null,
      });
      const response = await GET(request());
      expect(response.status).toBe(503);
    },
  );
});
