// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  resend: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: mocks }),
}));
vi.mock('../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.capture,
}));
import { handleSignUp } from '../../src/app/(auth)/auth/sign-up/request-handler';
import { handleEmailVerification } from '../../src/app/(auth)/auth/verification/request-handler';
const protection = { check: vi.fn(async () => ({ allowed: true as const })) };
const password = 'SyntheticOnly-123';
function request(path: string, participant = false) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
      'x-vercel-forwarded-for': '203.0.113.8',
    },
    body: new URLSearchParams({
      email: 'synthetic@example.test',
      password,
      confirmPassword: password,
      'cf-turnstile-response': 'synthetic-token',
      ...(participant ? { purpose: 'participant' } : {}),
    }),
  });
}
function resendRequest(participant = false) {
  return new NextRequest('http://localhost/auth/verification', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
      'x-vercel-forwarded-for': '203.0.113.8',
    },
    body: new URLSearchParams({
      email: 'synthetic@example.test',
      'cf-turnstile-response': 'synthetic-token',
      ...(participant ? { purpose: 'participant' } : {}),
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.signUp.mockReset();
  mocks.resend.mockReset();
  protection.check.mockResolvedValue({ allowed: true });
});
describe('honest non-enumerating signup feedback', () => {
  it.each([
    null,
    { code: 'email_exists' },
    { code: 'user_already_exists' },
    { message: 'already registered' },
  ])('keeps success/masked account outcomes neutral: %s', async (error) => {
    mocks.signUp.mockResolvedValue({ data: { user: null }, error });
    const r = await handleSignUp(request('/auth/sign-up'), {
      abuseProtection: protection,
    });
    expect(r.headers.get('location')).toBe('http://localhost/verify-email?signup=1');
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it.each([
    {
      code: 'unexpected_failure',
      status: 500,
      message: 'Synthetic SMTP535 private detail',
    },
    { code: 'over_email_send_rate_limit', status: 429 },
    { code: 'unknown' },
  ])('rejects operational failure without false verification or raw logs: %s', async (error) => {
    mocks.signUp.mockResolvedValue({ error });
    const r = await handleSignUp(request('/auth/sign-up', true), {
      abuseProtection: protection,
    });
    expect(r.headers.get('location')).toBe(
      'http://localhost/sign-up?error=unavailable&purpose=participant',
    );
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const [safe, context] = mocks.capture.mock.calls[0]!;
    expect(safe.code).toBe('integration_unavailable');
    expect(context).toEqual({ operation: 'auth.sign_up' });
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain('SMTP535');
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain(password);
  });
  it('does not create accounts after failed bot verification', async () => {
    const r = await handleSignUp(request('/auth/sign-up'), {
      abuseProtection: {
        check: async () => ({
          allowed: false,
          reason: 'bot_verification_required',
        }),
      },
    });
    expect(r.headers.get('location')).toContain('error=unavailable');
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
  it('handles interrupted provider signup as unavailable', async () => {
    mocks.signUp.mockRejectedValue(new Error('Synthetic private provider detail'));
    const r = await handleSignUp(request('/auth/sign-up'), {
      abuseProtection: protection,
    });
    expect(r.headers.get('location')).toBe('http://localhost/sign-up?error=unavailable');
  });
});
describe('honest non-enumerating resend feedback', () => {
  it.each([null, { code: 'user_not_found' }, { message: 'No user found' }])(
    'keeps existing/missing account outcomes neutral: %s',
    async (error) => {
      mocks.resend.mockResolvedValue({ error });
      const r = await handleEmailVerification(resendRequest(), {
        abuseProtection: protection,
      });
      expect(r.headers.get('location')).toBe('http://localhost/verify-email?sent=1');
    },
  );
  it.each([
    { code: 'unexpected_failure', status: 500 },
    { code: 'over_email_send_rate_limit', status: 429 },
  ])('does not say sent on provider failure: %s', async (error) => {
    mocks.resend.mockResolvedValue({ error });
    const r = await handleEmailVerification(resendRequest(true), {
      abuseProtection: protection,
    });
    expect(r.headers.get('location')).toBe(
      'http://localhost/verify-email?error=unavailable&purpose=participant',
    );
    expect(mocks.capture.mock.calls[0]?.[0]?.code).toBe('integration_unavailable');
  });
  it('handles interrupted resend without sent status', async () => {
    mocks.resend.mockRejectedValue(new Error('Synthetic private detail'));
    const r = await handleEmailVerification(resendRequest(), {
      abuseProtection: protection,
    });
    expect(r.headers.get('location')).toBe('http://localhost/verify-email?error=unavailable');
  });
});
