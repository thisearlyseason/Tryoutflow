import { installRecoveryLocks } from '../../helpers/recovery-lock';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
const route = vi.hoisted(() => ({ path: '/app/club/home' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
import { SetupRecoveryPrivacyGuard } from '@/modules/tryouts/ui/setup-recovery-privacy-guard';
import { RECOVERY_PREFIX, RECOVERY_OWNER } from '@/modules/tryouts/ui/setup-recovery-store';
beforeEach(() => {
  installRecoveryLocks();
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  localStorage.clear();
  route.path = '/app/club/home';
  localStorage.setItem(RECOVERY_PREFIX + 'fixture', 'local data');
  localStorage.setItem(RECOVERY_OWNER, 'user');
  localStorage.setItem('other.preference', 'keep');
});
it('purges on sign-in arrival without touching unrelated data', async () => {
  route.path = '/sign-in';
  render(<SetupRecoveryPrivacyGuard />);
  await waitFor(() => expect(localStorage.getItem(RECOVERY_PREFIX + 'fixture')).toBeNull());
  expect(localStorage.getItem('other.preference')).toBe('keep');
});
it('purges before native sign-out submission, even if it later fails', async () => {
  render(
    <>
      <SetupRecoveryPrivacyGuard />
      <form action="/auth/sign-out?returnTo=participant" method="post" data-testid="logout" />
    </>,
  );
  fireEvent.submit(document.querySelector('form')!);
  await waitFor(() => expect(localStorage.getItem(RECOVERY_PREFIX + 'fixture')).toBeNull());
  expect(localStorage.getItem(RECOVERY_OWNER)).toBeNull();
});
