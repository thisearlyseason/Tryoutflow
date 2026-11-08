// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/modules/identity/application/sign-out', () => ({ signOut: mocks.signOut }));
vi.mock('@/lib/request-origin', () => ({
  trustedRequestUrl: (_request: unknown, path: string) => new URL(path, 'https://app.example.test'),
}));
import { POST } from '@/app/(auth)/auth/sign-out/route';
describe('sign-out POST handoff', () => {
  it.each([
    [{ ok: true, value: { redirectTo: '/sign-in' } }, '/sign-in'],
    [{ ok: false, error: 'sign_out_failed' }, '/sign-in?error=sign_out_failed'],
  ])('uses a GET redirect after clearing or failing to clear a session', async (result, path) => {
    mocks.signOut.mockResolvedValue(result);
    const response = await POST(
      new NextRequest('https://app.example.test/auth/sign-out', { method: 'POST' }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://app.example.test' + path);
  });
});

it.each([
  [{ ok: true, value: { redirectTo: '/sign-in' } }, 'participant', '/sign-in?next=%2Fparticipant'],
  [
    { ok: false, error: 'sign_out_failed' },
    'participant',
    '/sign-in?error=sign_out_failed&next=%2Fparticipant',
  ],
  [{ ok: true, value: { redirectTo: '/sign-in' } }, 'https://evil.example', '/sign-in'],
])(
  'retains only the explicit family sign-in purpose after sign out',
  async (result, returnTo, path) => {
    mocks.signOut.mockResolvedValue(result);
    const request = new NextRequest(
      'https://app.example.test/auth/sign-out?returnTo=' + encodeURIComponent(returnTo),
      { method: 'POST' },
    );
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://app.example.test' + path);
  },
);
