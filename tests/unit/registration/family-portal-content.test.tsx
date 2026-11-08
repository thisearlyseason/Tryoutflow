import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
const user = { id: 'family-user', email: 'family@example.test' };
vi.mock('next/navigation', () => ({
  usePathname: () => '/participant',
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: () => {
    throw Error('REDIRECT');
  },
}));
vi.mock('@/modules/registration/application/participant-context', () => ({
  requireParticipantContext: async () => ({ user, client: { rpc: mocks.rpc } }),
}));
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: mocks.rpc,
  }),
}));
vi.mock('@/modules/identity/ui/private-session-boundary', () => ({
  PrivateSessionBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
import Portal from '@/app/(participant)/participant/page';
import Layout from '@/app/(participant)/participant/layout';
describe('family content in shared shell', () => {
  it.each([false, true])('preserves empty/linked approved content (linked=%s)', async (linked) => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      error: null,
      data:
        name === 'participant_workspace' && linked
          ? [
              {
                organization_id: 'org',
                athlete_id: 'athlete',
                organization: 'Synthetic club',
                name: 'Synthetic athlete',
                birth_date: null,
                profile: null,
                registrations: [],
                notices: [],
                fees: [],
                corrections: [],
                feedback: [
                  {
                    title: 'Approved coach feedback',
                    body: 'Keep practicing',
                    strengths: '',
                    development_areas: '',
                    recommendation: '',
                    kind: 'feedback',
                    due_on: null,
                    video_url: null,
                  },
                ],
              },
            ]
          : [],
    }));
    render(await Layout({ children: await Portal() }));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Family portal navigation' })).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Athlete and family portal', level: 1 }),
    ).toBeVisible();
    if (linked) expect(screen.getByText('Approved coach feedback')).toBeVisible();
    else expect(screen.getByRole('heading', { name: 'No athletes linked yet' })).toBeVisible();
  });
});
