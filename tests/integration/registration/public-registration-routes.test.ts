// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { recordIntegrationRateKey } from '../../fixtures/integration-lock/record-rate-key';
import { createDeterministicTestBotToken } from '../../../src/modules/identity/application/bot-protection';

vi.mock('server-only', () => ({}));

type Route = (request: NextRequest) => Promise<Response>;
let submitRegistration: Route;
let consumeConfirmation: Route;
let reissueConfirmation: Route;
let apiKeys: ReturnType<typeof localApiKeys>;
let directCanonicalRateKey = 'c'.repeat(64);

const origin = 'http://localhost';
const brandingUserId = 'a5101010-1010-4010-8010-101010101010';
const brandingOrganizationId = 'a1101010-1010-4010-8010-101010101010';
const brandingDigest = '3fe79651a92ea3850c3fc3dd9519a67c7f70b598fa238a3fd92042f6446e6452';
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const validSubmission = {
  givenName: 'Ava',
  familyName: 'Smith',
  birthDate: '2013-05-01',
  guardianName: 'Taylor Smith',
  guardianEmail: 'guardian@example.com',
  guardianPhone: '+1 (403) 555-0100',
  divisionId: 'c1101010-1010-4010-8010-101010101010',
  positionId: 'c2101010-1010-4010-8010-101010101010',
  responses: {
    email: 'player@example.com',
    phone: '+1 (403) 555-0101',
    date: '2024-02-29',
    position: 'Goalie',
    checked: false,
    consent: true,
  },
};

function localApiKeys() {
  const config = execFileSync(
    'docker',
    ['exec', 'supabase_kong_tryoutflow', 'cat', '/home/kong/kong.yml'],
    { encoding: 'utf8' },
  );
  const service = config.match(/sb_secret_[A-Za-z0-9_-]+/u)?.[0];
  const publishable = config.match(/sb_publishable_[A-Za-z0-9_-]+/u)?.[0];
  if (!service || !publishable) throw new Error('local Supabase API keys unavailable');
  return { service, publishable };
}

function psql(sql: string) {
  return execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    encoding: 'utf8',
  }).trim();
}

function latestQueuedConfirmationToken() {
  const text = psql(`
    select content_snapshot->>'text'
    from public.communication_messages
    where organization_id='a1101010-1010-4010-8010-101010101010'
      and message_kind='registration_confirmation'
    order by created_at desc,id desc limit 1
  `);
  const token = /[?&]token=([0-9a-f]{64})(?:&|$)/iu.exec(text)?.[1];
  if (!token) throw new Error('queued confirmation token unavailable');
  return token.toLowerCase();
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  const protectedPaths = new Set([
    '/api/public/registrations',
    '/api/public/registrations/confirmation',
    '/api/public/registrations/confirmation/reissue',
  ]);
  const protectedBody =
    protectedPaths.has(path) && body && typeof body === 'object' && !Array.isArray(body)
      ? {
          ...body,
          botVerificationToken:
            'botVerificationToken' in body
              ? (body as { botVerificationToken?: unknown }).botVerificationToken
              : createDeterministicTestBotToken(),
        }
      : body;
  return new NextRequest(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    body: JSON.stringify(protectedBody),
  });
}

beforeAll(async () => {
  const keys = localApiKeys();
  apiKeys = keys;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = keys.publishable;
  process.env.SUPABASE_SERVICE_ROLE_KEY = keys.service;
  process.env.PUBLIC_REGISTRATION_RATE_LIMIT_SECRET = `route-integration-${randomUUID()}`;
  process.env.ABUSE_PROTECTION_HMAC_SECRET = recordIntegrationRateKey('a'.repeat(64));
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  directCanonicalRateKey = recordIntegrationRateKey(directCanonicalRateKey);
  execFileSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', resolve('tests/fixtures/registration/seed.sql')],
    { stdio: 'pipe' },
  );
  submitRegistration = (await import('../../../src/app/api/public/registrations/route')).POST;
  consumeConfirmation = (
    await import('../../../src/app/api/public/registrations/confirmation/route')
  ).POST;
  reissueConfirmation = (
    await import('../../../src/app/api/public/registrations/confirmation/reissue/route')
  ).POST;
});

describe('real public registration route with local Supabase', () => {
  it('returns only the exact published organization name and conditional logo URL', async () => {
    const { GET: loadRegistration } =
      await import('../../../src/app/api/public/registrations/route');
    try {
      psql(`
        delete from private.organization_brand_assets
        where organization_id='${brandingOrganizationId}';
        insert into auth.users(id,email,email_confirmed_at)
        values('${brandingUserId}','branding-route@example.test',clock_timestamp())
        on conflict(id) do nothing;
      `);

      const absent = await loadRegistration(
        new NextRequest(`${origin}/api/public/registrations?tryoutSlug=http-registration-camp`),
      );
      expect(absent.status).toBe(200);
      const absentBody = (await absent.json()) as {
        organization: Record<string, unknown>;
      };
      expect(absentBody.organization).toEqual({ name: 'HTTP Registration Club' });

      psql(`
        insert into private.organization_brand_assets(
          organization_id,content,content_type,byte_length,sha256,updated_by_user_id
        ) values(
          '${brandingOrganizationId}',decode('524946460400000057454250','hex'),
          'image/webp',12,'${brandingDigest}','${brandingUserId}'
        );
      `);
      const present = await loadRegistration(
        new NextRequest(`${origin}/api/public/registrations?tryoutSlug=http-registration-camp`),
      );
      expect(present.status).toBe(200);
      await expect(present.json()).resolves.toMatchObject({
        organization: {
          name: 'HTTP Registration Club',
          logoUrl: '/api/organizations/http-registration-club/logo',
        },
        tryout: { name: 'HTTP Registration Camp', slug: 'http-registration-camp' },
      });
    } finally {
      psql(`
        delete from private.organization_brand_assets
        where organization_id='${brandingOrganizationId}';
        delete from public.profiles where id='${brandingUserId}';
        delete from auth.users where id='${brandingUserId}';
      `);
    }
  });

  it('exposes only the canonical submission RPC through real PostgREST', async () => {
    const headers = {
      apikey: apiKeys.service,
      authorization: `Bearer ${apiKeys.service}`,
      'content-type': 'application/json',
    };
    const legacy = await fetch(
      'http://127.0.0.1:54321/rest/v1/rpc/submit_public_registration_with_phone',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_tryout_slug: 'http-registration-camp',
          p_submission: validSubmission,
          p_idempotency_key: `legacy-denied-${randomUUID()}`,
          p_rate_key_hash: 'b'.repeat(64),
        }),
      },
    );
    expect(legacy.ok).toBe(false);
    expect([401, 403, 404]).toContain(legacy.status);

    const canonical = await fetch(
      'http://127.0.0.1:54321/rest/v1/rpc/submit_public_registration_v2',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_tryout_slug: 'http-registration-camp',
          p_submission: {
            ...validSubmission,
            givenName: 'PostgREST',
            guardianEmail: `postgrest-${randomUUID()}@example.com`,
          },
          p_idempotency_key: `canonical-${randomUUID()}`,
          p_rate_key_hash: directCanonicalRateKey,
        }),
      },
    );
    expect(canonical.status).toBe(200);
    await expect(canonical.json()).resolves.toEqual([
      expect.objectContaining({ outcome: 'submitted' }),
    ]);
  });

  it('uses submission.positionId as the only source and canonicalizes null to omitted', async () => {
    const duplicated = await submitRegistration(
      jsonRequest('/api/public/registrations', {
        tryoutSlug: 'http-registration-camp',
        idempotencyKey: `duplicate-position-${randomUUID()}`,
        positionId: 'c3101010-1010-4010-8010-101010101010',
        submission: validSubmission,
      }),
    );
    expect(duplicated.status).toBe(400);

    const idempotencyKey = `null-position-${randomUUID()}`;
    const guardianEmail = `null-position-${randomUUID()}@example.com`;
    const givenName = `Null${randomUUID().slice(0, 8)}`;
    const first = await submitRegistration(
      jsonRequest('/api/public/registrations', {
        tryoutSlug: 'http-registration-camp',
        idempotencyKey,
        submission: { ...validSubmission, givenName, guardianEmail, positionId: null },
      }),
    );
    expect(first.status).toBe(200);
    const replay = await submitRegistration(
      jsonRequest('/api/public/registrations', {
        tryoutSlug: 'http-registration-camp',
        idempotencyKey,
        submission: { ...validSubmission, givenName, guardianEmail, positionId: undefined },
      }),
    );
    expect(replay.status).toBe(200);
    expect(
      psql(
        `select count(*)||':'||coalesce(min(registration.position_id::text),'NULL') from public.tryout_registrations registration join public.guardians guardian on guardian.organization_id=registration.organization_id join public.athlete_guardians link on link.organization_id=guardian.organization_id and link.guardian_id=guardian.id and link.athlete_id=registration.athlete_id where guardian.normalized_email='${guardianEmail}'`,
      ),
    ).toBe('1:NULL');
  });

  it('returns published positions and persists the selected normalized position', async () => {
    const route = await import('../../../src/app/api/public/registrations/route');
    const get = await route.GET(
      new NextRequest(`${origin}/api/public/registrations?tryoutSlug=http-registration-camp`),
    );
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      tryout: {
        positions: [
          { id: validSubmission.positionId, name: 'Goalie' },
          { id: 'c3101010-1010-4010-8010-101010101010', name: 'Skater' },
        ],
      },
    });
    const familyName = `Position${randomUUID().slice(0, 8)}`;
    const idempotencyKey = `position-${randomUUID()}`;
    const guardianEmail = `position-${randomUUID()}@example.com`;
    const response = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        {
          tryoutSlug: 'http-registration-camp',
          idempotencyKey,
          submission: {
            ...validSubmission,
            familyName,
            guardianEmail,
          },
        },
        { 'x-forwarded-for': '203.0.113.230' },
      ),
    );
    expect(response.status).toBe(200);
    expect(
      psql(
        `select registration.position_id from public.tryout_registrations registration join public.athletes athlete on athlete.id=registration.athlete_id where athlete.family_name='${familyName}'`,
      ),
    ).toBe(validSubmission.positionId);
    const conflict = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        {
          tryoutSlug: 'http-registration-camp',
          idempotencyKey,
          submission: {
            ...validSubmission,
            familyName,
            guardianEmail,
            positionId: 'c3101010-1010-4010-8010-101010101010',
          },
        },
        { 'x-forwarded-for': '203.0.113.231' },
      ),
    );
    expect(conflict.status).toBe(400);
    expect(
      psql(
        `select count(*)||':'||min(registration.position_id::text) from public.tryout_registrations registration join public.athletes athlete on athlete.id=registration.athlete_id where athlete.family_name='${familyName}'`,
      ),
    ).toBe(`1:${validSubmission.positionId}`);
  });

  it('serializes concurrent same-key submissions with different positions', async () => {
    const idempotencyKey = `position-race-${randomUUID()}`;
    const familyName = `PositionRace${randomUUID().slice(0, 8)}`;
    const guardianEmail = `position-race-${randomUUID()}@example.com`;
    const requestFor = (positionId: string, address: string) =>
      submitRegistration(
        jsonRequest(
          '/api/public/registrations',
          {
            tryoutSlug: 'http-registration-camp',
            idempotencyKey,
            submission: { ...validSubmission, familyName, guardianEmail, positionId },
          },
          { 'x-forwarded-for': address },
        ),
      );
    const responses = await Promise.all([
      requestFor('c2101010-1010-4010-8010-101010101010', '203.0.113.232'),
      requestFor('c3101010-1010-4010-8010-101010101010', '203.0.113.233'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(
      psql(
        `select count(*)||':'||count(distinct registration.position_id) from public.tryout_registrations registration join public.athletes athlete on athlete.id=registration.athlete_id where athlete.family_name='${familyName}'`,
      ),
    ).toBe('1:1');
    expect(
      psql(
        `select count(*) from public.registration_confirmation_tokens token join public.tryout_registrations registration on registration.id=token.registration_id join public.athletes athlete on athlete.id=registration.athlete_id where athlete.family_name='${familyName}' and token.used_at is null and token.revoked_at is null`,
      ),
    ).toBe('1');
  });

  it.each([
    {
      label: 'composed stored identity and decomposed request',
      candidateId: '91101010-1010-4010-8010-101010101010',
      storedName: 'Jos\u00e9',
      submittedName: 'Jose\u0301',
      familyName: 'RouteComposed',
      birthDate: '2013-07-01',
      email: 'nfc-composed@example.com',
      address: '203.0.113.201',
      idempotencyKey: 'route-nfc-decomposed-key-00001',
    },
    {
      label: 'decomposed stored identity and composed request',
      candidateId: '92101010-1010-4010-8010-101010101010',
      storedName: 'Jose\u0301',
      submittedName: 'Jos\u00e9',
      familyName: 'RouteDecomposed',
      birthDate: '2013-08-01',
      email: 'nfc-decomposed@example.com',
      address: '203.0.113.202',
      idempotencyKey: 'route-nfc-composed-key-000001',
    },
  ])('emits an NFC duplicate candidate for $label without merging', async (testCase) => {
    const sqlText = (value: string) => value.replaceAll("'", "''");
    psql(`
      insert into public.athletes(
        id,organization_id,given_name,family_name,
        normalized_given_name,normalized_family_name,birth_date
      ) values(
        '${testCase.candidateId}','a1101010-1010-4010-8010-101010101010',
        '${sqlText(testCase.storedName)}','${testCase.familyName}','ignored','ignored','${testCase.birthDate}'
      );
      with guardian as(
        insert into public.guardians(organization_id,name,email,normalized_email)
        values(
          'a1101010-1010-4010-8010-101010101010','NFC Route Guardian',
          '${testCase.email}','${testCase.email}'
        ) returning id
      )
      insert into public.athlete_guardians(organization_id,athlete_id,guardian_id)
      select 'a1101010-1010-4010-8010-101010101010','${testCase.candidateId}',id from guardian;
    `);

    const response = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        {
          tryoutSlug: 'http-registration-camp',
          idempotencyKey: testCase.idempotencyKey,
          submission: {
            ...validSubmission,
            givenName: testCase.submittedName,
            familyName: testCase.familyName,
            birthDate: testCase.birthDate,
            guardianEmail: testCase.email,
          },
        },
        { 'x-forwarded-for': testCase.address },
      ),
    );

    expect(response.status).toBe(200);
    expect(
      psql(`
        select count(*)
        from public.registration_duplicate_candidates candidate
        join public.tryout_registrations registration on registration.id=candidate.registration_id
        join public.athletes submitted on submitted.id=registration.athlete_id
        where candidate.candidate_athlete_id='${testCase.candidateId}'
          and submitted.organization_id='a1101010-1010-4010-8010-101010101010'
          and submitted.family_name='${testCase.familyName}'
          and submitted.birth_date='${testCase.birthDate}'
      `),
    ).toBe('1');
    expect(
      psql(`
        select count(*)
        from public.athletes
        where organization_id='a1101010-1010-4010-8010-101010101010'
          and normalized_given_name=lower(public.canonical_import_text('${sqlText(testCase.submittedName)}'))
          and normalized_family_name=lower(public.canonical_import_text('${testCase.familyName}'))
          and birth_date='${testCase.birthDate}'
      `),
    ).toBe('2');
  });

  it('persists phone and returns a fresh usable token on an identical idempotent retry', async () => {
    const idempotencyKey = 'http-route-idempotency-key-000001';
    const first = await submitRegistration(
      jsonRequest('/api/public/registrations', {
        tryoutSlug: 'http-registration-camp',
        idempotencyKey,
        submission: validSubmission,
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      delivery?: string;
      manualConfirmationToken?: string;
    };
    expect(firstBody.delivery).toBe('queued');
    expect(firstBody.manualConfirmationToken).toBeUndefined();
    const firstToken = latestQueuedConfirmationToken();
    expect(firstToken).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      psql(
        "select phone from public.guardians where organization_id='a1101010-1010-4010-8010-101010101010' and normalized_email='guardian@example.com'",
      ),
    ).toBe('+1 (403) 555-0100');

    const replay = await submitRegistration(
      jsonRequest('/api/public/registrations', {
        tryoutSlug: 'http-registration-camp',
        idempotencyKey,
        submission: validSubmission,
      }),
    );
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { manualConfirmationToken?: string };
    expect(replayBody.manualConfirmationToken).toBeUndefined();
    const replayToken = latestQueuedConfirmationToken();
    expect(replayToken).toMatch(/^[0-9a-f]{64}$/u);
    expect(replayToken).not.toBe(firstToken);
    expect(
      psql(
        "select count(*) from public.tryout_registrations registration join public.athletes athlete on athlete.id=registration.athlete_id where registration.organization_id='a1101010-1010-4010-8010-101010101010' and athlete.given_name='Ava' and athlete.family_name='Smith' and athlete.birth_date='2013-05-01'",
      ),
    ).toBe('1');
    expect(
      psql(
        "select count(*) from public.registration_confirmation_tokens token join public.tryout_registrations registration on registration.id=token.registration_id join public.athletes athlete on athlete.id=registration.athlete_id where token.organization_id='a1101010-1010-4010-8010-101010101010' and athlete.given_name='Ava' and athlete.family_name='Smith' and athlete.birth_date='2013-05-01' and token.used_at is null and token.revoked_at is null",
      ),
    ).toBe('1');
  });

  it('returns truthful confirmation and replay states', async () => {
    const registration = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        {
          tryoutSlug: 'http-registration-camp',
          idempotencyKey: 'http-route-idempotency-key-000002',
          submission: { ...validSubmission, givenName: 'Bea' },
        },
        { 'x-forwarded-for': '203.0.113.11' },
      ),
    );
    await registration.json();
    const token = latestQueuedConfirmationToken();
    const confirmed = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token },
        { 'x-forwarded-for': '203.0.113.12' },
      ),
    );
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toEqual({ status: 'confirmed' });
    const replay = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token },
        { 'x-forwarded-for': '203.0.113.12' },
      ),
    );
    await expect(replay.json()).resolves.toEqual({ status: 'already_confirmed' });
  });

  it('requires a fresh server-verified bot token before confirmation and reissue mutation', async () => {
    const email = `bot-${randomUUID()}@example.com`;
    const registration = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        {
          tryoutSlug: 'http-registration-camp',
          idempotencyKey: `bot-confirm-${randomUUID()}`,
          submission: { ...validSubmission, givenName: 'BotConfirm', guardianEmail: email },
        },
        { 'x-forwarded-for': '203.0.113.180' },
      ),
    );
    expect(registration.status).toBe(200);
    await registration.json();
    const token = latestQueuedConfirmationToken();

    const rejected = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token, botVerificationToken: 'invalid-provider-token' },
        { 'x-forwarded-for': '203.0.113.181' },
      ),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual({ status: 'invalid' });
    expect(
      psql(
        `select used_at is null from public.registration_confirmation_tokens where token_digest=encode(extensions.digest('${token}','sha256'),'hex')`,
      ),
    ).toBe('t');

    const confirmed = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token },
        { 'x-forwarded-for': '203.0.113.181' },
      ),
    );
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toEqual({ status: 'confirmed' });

    const reissueEmail = `reissue-bot-${randomUUID()}@example.com`;
    const reissueRegistration = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        {
          tryoutSlug: 'http-registration-camp',
          idempotencyKey: `bot-reissue-${randomUUID()}`,
          submission: {
            ...validSubmission,
            givenName: 'BotReissue',
            guardianEmail: reissueEmail,
          },
        },
        { 'x-forwarded-for': '203.0.113.182' },
      ),
    );
    expect(reissueRegistration.status).toBe(200);
    await reissueRegistration.json();
    const reissueToken = latestQueuedConfirmationToken();
    const reissueRateRowsBefore = Number(
      psql("select count(*) from private.abuse_rate_limits where scope='registration_reissue'"),
    );
    const botReceiptRowsBefore = Number(psql('select count(*) from private.bot_token_receipts'));
    const rejectedReissue = await reissueConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation/reissue',
        {
          token: reissueToken,
          guardianEmail: reissueEmail,
          botVerificationToken: 'invalid-provider-token',
        },
        { 'x-forwarded-for': '203.0.113.183' },
      ),
    );
    expect(rejectedReissue.status).toBe(400);
    await expect(rejectedReissue.json()).resolves.toEqual({ status: 'invalid' });
    expect(
      Number(
        psql("select count(*) from private.abuse_rate_limits where scope='registration_reissue'"),
      ),
    ).toBe(reissueRateRowsBefore);
    expect(Number(psql('select count(*) from private.bot_token_receipts'))).toBe(
      botReceiptRowsBefore,
    );
    expect(
      psql(
        `select count(*) from public.registration_confirmation_tokens where registration_id=(select registration_id from public.registration_confirmation_tokens where token_digest=encode(extensions.digest('${reissueToken}','sha256'),'hex'))`,
      ),
    ).toBe('1');

    expect(
      Number(
        psql(
          "select count(*) from private.abuse_rate_limits where scope in('registration_confirmation','registration_reissue')",
        ),
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it('rejects undeclared confirmation and reissue fields before any mutation', async () => {
    const confirmation = await consumeConfirmation(
      jsonRequest('/api/public/registrations/confirmation', {
        token: 'a'.repeat(64),
        role: 'owner',
      }),
    );
    expect(confirmation.status).toBe(400);
    const reissue = await reissueConfirmation(
      jsonRequest('/api/public/registrations/confirmation/reissue', {
        token: 'b'.repeat(64),
        guardianEmail: 'guardian@example.com',
        role: 'owner',
      }),
    );
    expect(reissue.status).toBe(400);
  });

  it('enforces origin, exact MIME, and streamed multibyte byte limits on confirmation', async () => {
    const crossOrigin = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token: 'a'.repeat(64) },
        { origin: 'https://attacker.example' },
      ),
    );
    expect(crossOrigin.status).toBe(403);
    const wrongMime = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token: 'a'.repeat(64) },
        { 'content-type': 'application/ld+json' },
      ),
    );
    expect(wrongMime.status).toBe(403);

    const raw = JSON.stringify({ token: 'a'.repeat(64), padding: '🥅'.repeat(11_000) });
    const bytes = new TextEncoder().encode(raw);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1_000));
        controller.enqueue(bytes.subarray(1_000));
        controller.close();
      },
    });
    const oversized = new NextRequest(`${origin}/api/public/registrations/confirmation`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'content-length': '10',
        'x-forwarded-for': '203.0.113.13',
      },
      body: stream,
      duplex: 'half',
    } as unknown as ConstructorParameters<typeof NextRequest>[1]);
    const response = await consumeConfirmation(oversized);
    expect(response.status).toBe(413);
  });

  it('applies the same MIME and actual-byte defenses to registration', async () => {
    const body = {
      tryoutSlug: 'http-registration-camp',
      idempotencyKey: 'registration-security-key-00001',
      submission: validSubmission,
    };
    const wrongMime = await submitRegistration(
      jsonRequest('/api/public/registrations', body, { 'content-type': 'text/plain' }),
    );
    expect(wrongMime.status).toBe(403);
    const oversized = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        { ...body, padding: '🥅'.repeat(11_000) },
        { 'content-length': '10' },
      ),
    );
    expect(oversized.status).toBe(413);
  });

  it('returns a stable 429 from the confirmation limiter', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await consumeConfirmation(
        jsonRequest(
          '/api/public/registrations/confirmation',
          { token: 'c'.repeat(64) },
          { 'x-forwarded-for': '203.0.113.50' },
        ),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([...Array(10).fill(200), 429]);
  });

  it('rate-limits random confirmation tokens by stable context with bounded durable rows', async () => {
    const address = '203.0.113.151';
    const before = Number(psql('select count(*) from public.registration_rate_counters'));
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const token = attempt.toString(16).padStart(64, '0');
      const response = await consumeConfirmation(
        jsonRequest(
          '/api/public/registrations/confirmation',
          { token },
          { 'x-forwarded-for': address },
        ),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses.slice(10)).toEqual(Array(20).fill(429));
    const after = Number(psql('select count(*) from public.registration_rate_counters'));
    expect(after - before).toBeLessThanOrEqual(11);
  });

  it('rate-limits rotating reissue tokens and emails with one fixed-cardinality durable row', async () => {
    const address = '203.0.113.152';
    const before = Number(
      psql("select count(*) from private.abuse_rate_limits where scope='registration_reissue'"),
    );
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const token = (attempt + 100).toString(16).padStart(64, '0');
      const response = await reissueConfirmation(
        jsonRequest(
          '/api/public/registrations/confirmation/reissue',
          { token, guardianEmail: `rotating-${attempt}@example.com` },
          { 'x-forwarded-for': address },
        ),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 4)).toEqual(Array(4).fill(200));
    expect(statuses.slice(4)).toEqual(Array(16).fill(429));
    const after = Number(
      psql("select count(*) from private.abuse_rate_limits where scope='registration_reissue'"),
    );
    expect(after - before).toBe(1);
    expect(
      psql(
        "select count(*) from private.abuse_rate_limits where to_jsonb(abuse_rate_limits)::text like '%rotating-%'",
      ),
    ).toBe('0');
  });

  it('atomically enforces confirmation and reissue scopes under concurrent token rotation', async () => {
    const confirmationResponses = await Promise.all(
      Array.from({ length: 30 }, (_unused, attempt) =>
        consumeConfirmation(
          jsonRequest(
            '/api/public/registrations/confirmation',
            { token: (attempt + 1_000).toString(16).padStart(64, '0') },
            { 'x-forwarded-for': '203.0.113.190' },
          ),
        ),
      ),
    );
    expect(confirmationResponses.map(({ status }) => status).sort()).toEqual([
      ...Array(10).fill(200),
      ...Array(20).fill(429),
    ]);

    const reissueRowsBefore = Number(
      psql("select count(*) from private.abuse_rate_limits where scope='registration_reissue'"),
    );
    const reissueResponses = await Promise.all(
      Array.from({ length: 12 }, (_unused, attempt) =>
        reissueConfirmation(
          jsonRequest(
            '/api/public/registrations/confirmation/reissue',
            {
              token: (attempt + 2_000).toString(16).padStart(64, '0'),
              guardianEmail: 'concurrent-guardian@example.com',
            },
            { 'x-forwarded-for': '203.0.113.191' },
          ),
        ),
      ),
    );
    expect(reissueResponses.map(({ status }) => status).sort()).toEqual([
      ...Array(4).fill(200),
      ...Array(8).fill(429),
    ]);
    expect(
      Number(
        psql("select count(*) from private.abuse_rate_limits where scope='registration_reissue'"),
      ) - reissueRowsBefore,
    ).toBe(1);
  });

  it('durably rate-limits malformed submissions before the registration transaction rolls back', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await submitRegistration(
        jsonRequest(
          '/api/public/registrations',
          {
            tryoutSlug: 'http-registration-camp',
            idempotencyKey: `malformed-route-attempt-${String(attempt).padStart(8, '0')}`,
            submission: {
              ...validSubmission,
              responses: { ...validSubmission.responses, email: 'bad' },
            },
          },
          { 'x-forwarded-for': '203.0.113.99' },
        ),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(400));
    expect(statuses[10]).toBe(429);
  });

  it('reports expiry and reissues only with token possession plus guardian proof', async () => {
    const registration = await submitRegistration(
      jsonRequest(
        '/api/public/registrations',
        {
          tryoutSlug: 'http-registration-camp',
          idempotencyKey: 'http-route-idempotency-key-000003',
          submission: { ...validSubmission, givenName: 'Cara' },
        },
        { 'x-forwarded-for': '203.0.113.30' },
      ),
    );
    await registration.json();
    const oldToken = latestQueuedConfirmationToken();
    psql(
      `update public.registration_confirmation_tokens set created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' where token_digest=encode(extensions.digest('${oldToken}','sha256'),'hex')`,
    );
    const expired = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token: oldToken },
        { 'x-forwarded-for': '203.0.113.31' },
      ),
    );
    await expect(expired.json()).resolves.toEqual({ status: 'expired' });

    const wrongProof = await reissueConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation/reissue',
        { token: oldToken, guardianEmail: 'wrong@example.com' },
        { 'x-forwarded-for': '203.0.113.32' },
      ),
    );
    await expect(wrongProof.json()).resolves.toEqual({ status: 'invalid' });
    const unknownToken = await reissueConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation/reissue',
        { token: 'f'.repeat(64), guardianEmail: 'guardian@example.com' },
        { 'x-forwarded-for': '203.0.113.32' },
      ),
    );
    await expect(unknownToken.json()).resolves.toEqual({ status: 'invalid' });

    const reissued = await reissueConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation/reissue',
        { token: oldToken, guardianEmail: ' GUARDIAN@example.com ' },
        { 'x-forwarded-for': '203.0.113.33' },
      ),
    );
    expect(reissued.status).toBe(200);
    const reissuedBody = (await reissued.json()) as {
      status: string;
      manualConfirmationToken: string;
    };
    expect(reissuedBody.status).toBe('reissued');
    expect(reissuedBody.manualConfirmationToken).toMatch(/^[0-9a-f]{64}$/u);
    expect(reissuedBody.manualConfirmationToken).not.toBe(oldToken);
    const oldResult = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token: oldToken },
        { 'x-forwarded-for': '203.0.113.34' },
      ),
    );
    await expect(oldResult.json()).resolves.toEqual({ status: 'invalid' });
    const newResult = await consumeConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation',
        { token: reissuedBody.manualConfirmationToken },
        { 'x-forwarded-for': '203.0.113.34' },
      ),
    );
    await expect(newResult.json()).resolves.toEqual({ status: 'confirmed' });
  });

  it('applies the same MIME, byte-limit, and stable limiter defenses to reissue', async () => {
    const wrongMime = await reissueConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation/reissue',
        { token: 'e'.repeat(64), guardianEmail: 'guardian@example.com' },
        { 'content-type': 'text/plain', 'x-forwarded-for': '203.0.113.40' },
      ),
    );
    expect(wrongMime.status).toBe(403);

    const oversized = await reissueConfirmation(
      jsonRequest(
        '/api/public/registrations/confirmation/reissue',
        { token: 'e'.repeat(64), guardianEmail: 'a'.repeat(33 * 1024) },
        { 'content-length': '10', 'x-forwarded-for': '203.0.113.40' },
      ),
    );
    expect(oversized.status).toBe(413);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await reissueConfirmation(
        jsonRequest(
          '/api/public/registrations/confirmation/reissue',
          { token: 'd'.repeat(64), guardianEmail: 'guardian@example.com' },
          { 'x-forwarded-for': '203.0.113.41' },
        ),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429]);
  });
});
