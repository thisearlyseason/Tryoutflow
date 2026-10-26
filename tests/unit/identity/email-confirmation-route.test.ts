import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ verifyOtp: vi.fn(), create: vi.fn() }));
vi.mock('@/infrastructure/supabase/server', () => ({ createServerSupabaseClient: mocks.create }));
vi.mock('@/lib/request-origin', () => ({
  trustedRequestUrl: (_: unknown, path: string) => new URL(path, 'https://www.tryout.agency'),
}));
import { GET } from '@/app/(auth)/auth/confirm/route';
afterEach(() => vi.resetAllMocks());
async function call(parameters: Record<string, string>) {
  mocks.create.mockResolvedValue({ auth: { verifyOtp: mocks.verifyOtp } });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  return GET(
    new NextRequest('https://www.tryout.agency/auth/confirm?' + new URLSearchParams(parameters)),
  );
}
it('exchanges a delivered token on the server and strips it from the destination', async () => {
  const r = await call({ token_hash: 'verified-token', type: 'magiclink' });
  expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'verified-token', type: 'magiclink' });
  expect(r.headers.get('location')).toBe('https://www.tryout.agency/app');
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(r.headers.get('referrer-policy')).toBe('no-referrer');
});
it.each(['recovery', 'invite'])('routes %s to password setup', async (type) => {
  const r = await call({
    token_hash: 'verified-token',
    type,
    redirect_to: 'https://www.tryout.agency/',
  });
  expect(r.headers.get('location')).toBe('https://www.tryout.agency/reset-password');
});
it('preserves the participant signup destination nested in the existing callback', async () => {
  const r = await call({
    token_hash: 'verified-token',
    type: 'signup',
    redirect_to: 'https://www.tryout.agency/auth/callback?next=%2Fparticipant',
  });
  expect(r.headers.get('location')).toBe('https://www.tryout.agency/participant');
});
it.each([
  'https://evil.example/path',
  '//evil.example',
  'https://www.tryout.agency/auth/callback?next=%2F%2Fevil.example',
])('rejects external redirects: %s', async (redirect_to) => {
  const r = await call({ token_hash: 'verified-token', type: 'magiclink', redirect_to });
  expect(r.headers.get('location')).toBe('https://www.tryout.agency/app');
});
it.each([
  { type: 'magiclink' },
  { type: 'sms', token_hash: 'token' },
  { type: 'magiclink', token_hash: 'bad token' },
])('rejects malformed input before verification', async (parameters) => {
  const r = await call(parameters as Record<string, string>);
  expect(r.headers.get('location')).toContain('auth_callback_missing');
  expect(mocks.verifyOtp).not.toHaveBeenCalled();
});
it('rejects expired or reused tokens', async () => {
  mocks.create.mockResolvedValue({ auth: { verifyOtp: mocks.verifyOtp } });
  mocks.verifyOtp.mockResolvedValue({ error: { message: 'expired' } });
  const r = await GET(
    new NextRequest('https://www.tryout.agency/auth/confirm?type=magiclink&token_hash=used-token'),
  );
  expect(r.headers.get('location')).toBe(
    'https://www.tryout.agency/sign-in?error=auth_callback_failed',
  );
});
